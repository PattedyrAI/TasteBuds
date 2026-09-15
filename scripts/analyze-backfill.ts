/** Local read-only evidence analysis. No AI calls, promotions, migrations or database writes. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

type Row = Record<string, any>;
const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bump = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] || 0) + 1; };

// Literal brand prefixes visible in the existing product-name evidence. No brand equivalence/renaming.
const brandPrefixes = ['Red Bull', 'Alani Nu', 'Black Rifle', 'Rip It', 'Faxe Kondi', 'Monster', 'Ghost', 'Ryse', 'C4', 'Battery', 'Celsius', 'Rockstar', 'Cabot', 'Reign', 'Kraft', 'Bang'].sort((a, b) => b.length - a.length);
const explicitTypes: [RegExp, string][] = [
  [/\bmac(?:aroni)?\s*(?:and|&|'n|n)\s*cheese\b/i, 'Mac and cheese'],
  [/\b(?:coffee|espresso|cappuccino|latte)\b/i, 'Coffee'],
  [/\benergy(?:\s+drink)?\b/i, 'Energy drinks'],
  [/\bpizza\b/i, 'Pizza'], [/\b(?:cheeseburger|burger)\b/i, 'Burgers'],
  [/\bsushi\b/i, 'Sushi'], [/\b(?:noodles|ramen)\b/i, 'Noodles'],
  [/\bfries\b/i, 'Fries'], [/\bice cream\b/i, 'Ice cream'],
];

export async function analyzeBackfill(connectionString: string, exportDir: string) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/everrate(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('Analysis requires a local TasteBuds database.');
  const sourceFiles: { relativePath: string; sha256: string }[] = [];
  const read = async (file: string) => {
    const bytes = await readFile(join(exportDir, file));
    sourceFiles.push({ relativePath: file, sha256: createHash('sha256').update(bytes).digest('hex') });
    return JSON.parse(bytes.toString('utf8'));
  };
  const proposals: Row[] = await read('import-ready.json');
  const parsedProposals: Row[] = await read('proposed.json');
  const messages: Row[] = await read('messages.json');
  const labels: Row[] = await read('names/all.json');
  const visionWork: Row[] = await read('vision-work.json');
  const canonical: Record<string, string> = await read('names/canonical.json');
  const authors: Record<string, string> = await read('authors.json');
  const db = new Client({ connectionString, application_name: 'everrate-backfill-analysis-read-only', connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  await db.connect();
  let items: Row[], ratings: Row[], revisions: Row[], issues: Row[], archiveFiles: Row[];
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    items = (await db.query('SELECT id,group_id,name,brand_id,variant,type_id,broad_category,legacy_metadata FROM everrate.items')).rows;
    ratings = (await db.query('SELECT id,item_id,user_id,group_id,source_message_id,tasted_at,photo_id,deleted_at,legacy_metadata FROM everrate.ratings')).rows;
    revisions = (await db.query('SELECT id,rating_id,previous_value FROM everrate.rating_revisions')).rows;
    issues = (await db.query("SELECT reason,raw_record FROM everrate.import_issues WHERE resolved_at IS NULL AND reason IN ('legacy_item_requires_reconciliation','proposal_not_promoted_without_event_proof')")).rows;
    archiveFiles = (await db.query('SELECT id,relative_path,sha256,blob_sha256 FROM everrate.archive_files')).rows;
    await db.query('ROLLBACK');
  } finally { await db.end(); }
  if (!ratings.length) throw new Error('No imported ratings found; select the reconciled import database.');
  if (sourceFiles.some(file => !archiveFiles.some(archived => archived.relative_path === file.relativePath && archived.sha256 === file.sha256))) throw new Error('Local evidence differs from the imported archive.');

  const byItem = new Map(items.map(item => [item.id, item]));
  const byRating = new Map(ratings.map(rating => [rating.id, rating]));
  const byMessage = new Map(messages.map(message => [message.id, message]));
  const represented = new Set(ratings.map(rating => rating.source_message_id).filter(Boolean));
  const ambiguousItems = new Set(issues.filter(issue => issue.reason === 'legacy_item_requires_reconciliation').map(issue => issue.raw_record.id));
  const sourceMultiplicity = new Map<string, number>();
  for (const proposal of proposals) sourceMultiplicity.set(proposal.messageId, (sourceMultiplicity.get(proposal.messageId) || 0) + 1);
  const parsedMultiplicity = new Map<string, number>();
  for (const proposal of parsedProposals) parsedMultiplicity.set(proposal.messageId, (parsedMultiplicity.get(proposal.messageId) || 0) + 1);
  const labelByPath = new Map(labels.map(label => [basename(label.image), label]));
  const attachmentIds = new Map<string, Set<string>>();
  const attachmentMessage = new Map<string, Row>();
  for (const message of messages) for (const attachment of message.attachments || []) {
    const key = basename(attachment.localPath);
    const ids = attachmentIds.get(key) || new Set<string>(); ids.add(attachment.id); attachmentIds.set(key, ids);
    attachmentMessage.set(key, message);
  }
  const collisionPaths = new Set([...attachmentIds].filter(([, ids]) => ids.size > 1).map(([key]) => key));
  const proposalByKey = new Map(proposals.map(proposal => [proposal.discordMessageId, proposal]));
  const visionByKey = new Map(visionWork.map(work => [work.discordMessageId, work]));
  const visionImageUse = new Map<string, number>();
  for (const work of visionWork) visionImageUse.set(basename(work.image), (visionImageUse.get(basename(work.image)) || 0) + 1);
  function vettedVision(proposal: Row) {
    const work = visionByKey.get(proposal.discordMessageId);
    if (!work) return null;
    const key = basename(work.image), photoMessage = attachmentMessage.get(key), ratingMessage = byMessage.get(proposal.messageId);
    if (!photoMessage || !ratingMessage || collisionPaths.has(key)) return null;
    if (photoMessage.id === ratingMessage.id) return work;
    const gap = Date.parse(ratingMessage.createdAt) - Date.parse(photoMessage.createdAt);
    const interveningImage = messages.some(message => message.authorId === ratingMessage.authorId && message.channelId === ratingMessage.channelId && message.attachments?.length && Date.parse(message.createdAt) > Date.parse(photoMessage.createdAt) && Date.parse(message.createdAt) < Date.parse(ratingMessage.createdAt));
    return photoMessage.authorId === ratingMessage.authorId && photoMessage.channelId === ratingMessage.channelId && gap >= 0 && gap <= 300_000 &&
      photoMessage.attachments.length === 1 && !parsedMultiplicity.has(photoMessage.id) && parsedMultiplicity.get(ratingMessage.id) === 1 && visionImageUse.get(key) === 1 && !interveningImage ? work : null;
  }

  // This exact surviving item prefix is documented in the historical cleanup plan.
  // A matching surviving message plus the two documented relay labels identifies the removed slots.
  const moderatedBases = new Set(ratings.filter(rating => rating.item_id.startsWith('1b954285')).map(rating => rating.source_message_id?.split('#')[0]).filter(Boolean));
  const classifications: Record<string, number> = {};
  const candidateEvents: Row[] = [];
  for (const proposal of proposals.filter(proposal => !represented.has(proposal.discordMessageId))) {
    const current = ratings.filter(rating => !rating.deleted_at && rating.user_id === authors[proposal.authorId] && normalize(byItem.get(rating.item_id)?.name) === normalize(proposal.itemName));
    const message = byMessage.get(proposal.messageId);
    let classification: string;
    let snapshotMatches: Row[] = [];
    if (moderatedBases.has(proposal.messageId) && ['🐟', 'C'].includes(proposal.itemName)) classification = 'known_moderated_relay_do_not_restore';
    else if ((parsedMultiplicity.get(proposal.messageId) || 0) > 1) classification = 'multi_rating_message_requires_rater_proof';
    else if (!message || message.authorId !== proposal.authorId || !authors[proposal.authorId]) classification = 'source_author_unresolved';
    else if (current.length !== 1) classification = 'item_mapping_unresolved';
    else if (ambiguousItems.has(current[0].item_id)) classification = 'known_artifact_item';
    else if ((proposal.attachmentLocalPaths || []).some((path: string) => collisionPaths.has(basename(path)))) classification = 'attachment_bytes_ambiguous';
    else {
      snapshotMatches = revisions.filter(revision => {
        const rating = byRating.get(revision.rating_id), previous = revision.previous_value;
        return rating && rating.user_id === authors[proposal.authorId] && Number(previous.previous_score) === proposal.score && (previous.previous_comment || null) === (proposal.comment || null) &&
          (!previous.previous_photo_url ? !(proposal.attachmentLocalPaths || []).length : (proposal.attachmentLocalPaths || []).some((path: string) => previous.previous_photo_url.endsWith('/' + proposal.messageId + '-' + basename(path))));
      });
      const targets = [...new Set(snapshotMatches.map(revision => revision.rating_id))];
      classification = targets.length === 1 && targets[0] === current[0].id && Date.parse(proposal.createdAt) < Date.parse(current[0].tasted_at)
        ? 'distinct_prior_message_with_unique_snapshot_target' : 'snapshot_or_event_identity_unresolved';
    }
    bump(classifications, classification);
    const sourcePhotos = (candidate: Row | undefined): string[] => candidate ? [...new Set([...(candidate.attachmentLocalPaths || []), ...(vettedVision(candidate) ? [vettedVision(candidate)!.image] : [])].map((path: string) => basename(path)))] : [];
    const priorPaths=sourcePhotos(proposal), currentPaths=current.length===1?sourcePhotos(proposalByKey.get(current[0].source_message_id)):[];
    const imageHashes=(paths:string[])=>new Set(archiveFiles.filter(file=>paths.includes(basename(file.relative_path))&&file.relative_path.startsWith('attachments/')).map(file=>file.sha256));
    const priorHashes=imageHashes(priorPaths),currentHashes=imageHashes(currentPaths);
    const photoComparison=!priorHashes.size?'no_photo_in_prior':!currentHashes.size?'not_comparable':[...priorHashes].some(value=>currentHashes.has(value))?'same':'distinct';
    const calendarDayDifferent=current.length===1&&new Date(proposal.createdAt).toISOString().slice(0,10)!==new Date(current[0].tasted_at).toISOString().slice(0,10);
    candidateEvents.push({
      sourceKey: proposal.discordMessageId, sourceProposalSha256: digest(proposal), classification,
      targetItemId: current.length === 1 ? current[0].item_id : null,
      targetUserId: authors[proposal.authorId] || null,
      relatedCurrentRatingId: current.length === 1 ? current[0].id : null,
      supportingRevisionIds: snapshotMatches.map(revision => revision.id),
      supportingRevisionHashes:snapshotMatches.map(revision=>({id:revision.id,sha256:digest(revision.previous_value)})),
      priorPhoto:priorPaths.length?(()=>{const file=archiveFiles.find(file=>file.relative_path==='attachments/'+priorPaths[0]&&file.blob_sha256);return file?{archiveFileId:file.id,relativeImage:file.relative_path,originalSha256:file.sha256}:null;})():null,
      priorPhotoHashes:[...priorHashes],currentPhotoHashes:[...currentHashes],
      sourceCreatedAt: proposal.createdAt, score: proposal.score, rawScore: proposal.rawScore,
      hasSourcePhoto: Boolean(proposal.attachmentLocalPaths?.length),
      calendarDayDifferent, photoComparison,
      strongerReviewCandidate:classification==='distinct_prior_message_with_unique_snapshot_target'&&calendarDayDifferent&&photoComparison!=='same',
      // Counts/IDs only: never emit original note or raw message content.
      proposalNameSource: proposal.nameSource,
    });
  }

  const itemSuggestions: Row[] = [];
  const photoSuggestions: Row[] = [];
  const itemCounts: Record<string, number> = {};
  for (const item of items) {
    const linked = ratings.filter(rating => rating.item_id === item.id && !rating.deleted_at).map(rating => proposalByKey.get(rating.source_message_id)).filter(Boolean) as Row[];
    const cached = linked.flatMap(proposal => {
      const paths = [...(proposal.attachmentLocalPaths || [])];
      const work = vettedVision(proposal); if (work) paths.push(work.image);
      return [...new Set(paths.map((path: string) => basename(path)))].map(path => labelByPath.get(path)).filter(Boolean);
    }) as Row[];
    const high = cached.filter(label => label.name && label.confidence === 'high' && !collisionPaths.has(basename(label.image)));
    if (cached.length) bump(itemCounts, 'itemsWithLinkedCachedLabel');
    if (high.length) bump(itemCounts, 'itemsWithLinkedHighConfidenceLabel');
    if (ambiguousItems.has(item.id)) { bump(itemCounts, 'artifactItemsExcluded'); continue; }
    // Existing names stay intact. Only an identical high-confidence image label can support extraction.
    const exact = high.filter(label => normalize(label.name) === normalize(item.name) && (!canonical[label.name] || normalize(canonical[label.name]) === normalize(label.name)));
    if (!exact.length) { bump(itemCounts, 'itemsWithoutUnchangedExactHighConfidenceLabel'); continue; }
    bump(itemCounts, 'itemsWithUnchangedExactHighConfidenceLabel');
    const brand = brandPrefixes.find(prefix => normalize(item.name).startsWith(normalize(prefix) + ' '));
    const type = explicitTypes.find(([pattern]) => pattern.test(item.name))?.[1];
    const patch: Record<string, string> = {};
    if (!item.brand_id && brand) patch.brand = brand;
    if (!item.type_id && type) patch.type = type;
    // A full product label does not prove a separate variant field. Leave it unchanged.
    if (Object.keys(patch).length) {
      if (patch.brand) bump(itemCounts, 'literalBrandSuggestions');
      if (patch.type) bump(itemCounts, 'literalTypeSuggestions');
      itemSuggestions.push({ itemId: item.id, groupId: item.group_id, patch, expectedNameSha256: digest(item.name), expectedBrandId: item.brand_id, expectedTypeId: item.type_id, evidence: exact.map(label => ({ sourceFile: 'names/all.json', labelSha256: digest(label), relativeImage: 'attachments/' + basename(label.image) })) });
    }
  }
  for (const rating of ratings.filter(rating => !rating.deleted_at && !rating.photo_id && !ambiguousItems.has(rating.item_id))) {
    const proposal = proposalByKey.get(rating.source_message_id), item = byItem.get(rating.item_id);
    if (!proposal || !item || authors[proposal.authorId] !== rating.user_id || parsedMultiplicity.get(proposal.messageId) !== 1) continue;
    const work = vettedVision(proposal); if (!work) continue;
    const label = labelByPath.get(basename(work.image));
    if (!label?.name || label.confidence !== 'high' || normalize(label.name) !== normalize(item.name) || (canonical[label.name] && normalize(canonical[label.name]) !== normalize(label.name))) continue;
    const relativeImage = 'attachments/' + basename(work.image), originals = archiveFiles.filter(file => file.relative_path === relativeImage && file.blob_sha256);
    if (new Set(originals.map(file => file.sha256)).size !== 1) continue;
    photoSuggestions.push({ ratingId: rating.id, groupId: rating.group_id, userId: rating.user_id, itemId: rating.item_id, sourceKey: proposal.discordMessageId, relativeImage, archiveFileId: originals[0].id, originalSha256: originals[0].sha256, sourceImageMessageId: attachmentMessage.get(basename(work.image))!.id, labelSha256: digest(label), sourceWorkSha256: digest(work), expectedPhotoId: null, expectedNameSha256: digest(item.name) });
  }
  const attachmentNames = new Set([...attachmentIds.keys()]);
  const labeledPaths = new Set(labels.filter(label => label.name).map(label => basename(label.image)));
  const candidateStrong = candidateEvents.filter(event => event.classification === 'distinct_prior_message_with_unique_snapshot_target');
  return {
    summary: {
      readOnly: true, analyzedAt: new Date().toISOString(), importedItems: items.length, importedRatings: ratings.length, preservedRevisions: revisions.length,
      archive: { files: archiveFiles.length, attachmentFiles: archiveFiles.filter(file => file.relative_path.startsWith('attachments/')).length }, labels: { total: labels.length, named: labels.filter(label => label.name).length, highConfidence: labels.filter(label => label.name && label.confidence === 'high').length, physicalPaths: attachmentNames.size, pathsWithoutCachedName: [...attachmentNames].filter(path => !labeledPaths.has(path)).length, ambiguousPaths: collisionPaths.size },
      items: { ...itemCounts, suggestedUpdates: itemSuggestions.length, variantUpdates: 0 },
      photos: { vettedSuggestionsForExistingRatings: photoSuggestions.length },
      proposals: { reviewed: proposals.length, represented: proposals.filter(proposal => represented.has(proposal.discordMessageId)).length, pending: candidateEvents.length, classifications, strongCandidatesWithPhoto: candidateStrong.filter(event => event.hasSourcePhoto).length, strongCandidatesWithoutPhoto: candidateStrong.filter(event => !event.hasSourcePhoto).length, distinctDayCandidates: candidateStrong.filter(event=>event.calendarDayDifferent).length, stricterReviewCandidates:candidateStrong.filter(event=>event.strongerReviewCandidate).length, stricterDistinctPhoto:candidateStrong.filter(event=>event.strongerReviewCandidate&&event.photoComparison==='distinct').length, stricterPhotoNotComparable:candidateStrong.filter(event=>event.strongerReviewCandidate&&event.photoComparison==='not_comparable').length, stricterNoPriorPhoto:candidateStrong.filter(event=>event.strongerReviewCandidate&&event.photoComparison==='no_photo_in_prior').length },
      noWritesPerformed: true, noProviderCallsPerformed: true,
    },
    plan: { version: 1, sourceFiles, itemSuggestions, photoSuggestions, candidateEvents },
  };
}

async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: npx tsx scripts/analyze-backfill.ts [--plan]\nReads BACKFILL_DATABASE_URL (local only) and LEGACY_EXPORT_DIR. Default output contains aggregates only. --plan includes private source/target IDs and proposed metadata, never notes or message bodies. Performs no writes or provider calls.'); return; }
  if (process.argv.slice(2).some(arg => arg !== '--plan')) throw new Error('Unknown option.');
  const result = await analyzeBackfill(process.env.BACKFILL_DATABASE_URL || 'postgresql://127.0.0.1:55439/everrate_import_test', process.env.LEGACY_EXPORT_DIR || '.private/legacy-export');
  console.log(JSON.stringify(process.argv.includes('--plan') ? result : result.summary, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => { console.error('Backfill analysis failed. Check local database/source configuration; no private records or credentials were logged.'); process.exitCode = 1; });
