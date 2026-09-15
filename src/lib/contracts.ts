/** Public browser/server contracts. Never add provider credentials to these types. */
export interface User { id: string; discordId: string | null; nickname: string | null; aiEnabled: boolean; displayName: string; avatarUrl: string | null }
/** memberCount counts current members with at least one nondeleted rating; members remains the full management roster. */
export interface Group { id: string; name: string; ownerId: string; role: 'owner' | 'member'; memberCount: number; createdAt: string }
export interface Member extends User { role: 'owner' | 'member'; joinedAt: string }
export interface Person { id: string; displayName: string; avatarUrl: string | null; role: 'owner' | 'member'; joinedAt: string; ratingCount: number; itemCount: number; lastRatedAt: string | null }
export interface PersonRating { isRereview?: boolean; countsTowardAverage?: boolean; id: string; itemId: string; itemName: string; brand: string | null; variant: string | null; score: number; note: string | null; photoId: string | null; tastedAt: string; legacyPhotoMissing: boolean }
export interface PersonRatingsPage { person: Person; ratings: PersonRating[]; nextCursor: string | null }
export interface GroupDetail extends Group { inviteCode: string | null; members: Member[]; discordConnected: boolean; stats: { itemCount: number; tastingCount: number; activeMembers: number } }
export interface Bootstrap { user: User; groups: Group[] }
export interface Item { reviewers?: Pick<User, 'id' | 'displayName' | 'avatarUrl'>[]; id: string; groupId: string; createdBy: string; name: string; brand: string | null; variant: string | null; type: string | null; broadCategory: string | null; photoId: string | null; average: number | null; raterCount: number; tastingCount: number; lastRatedAt: string | null }
export interface Comment { id: string; ratingId: string; author: User; body: string; createdAt: string }
export interface Rating { isRereview?: boolean; countsTowardAverage?: boolean; id: string; groupId: string; itemId: string; author: User; score: number; note: string | null; tastedAt: string; createdAt: string; updatedAt: string; photoId: string | null; legacyPhotoMissing: boolean; comments: Comment[] }
export interface FeedEntry extends Rating { itemName: string; brand: string | null; variant: string | null }
export interface ItemDetail extends Item { ratings: Rating[] }
export interface CreateRatingInput { groupId: string; itemId?: string; name?: string; brand?: string | null; variant?: string | null; type?: string | null; broadCategory?: string | null; score: number; note?: string | null; tastedAt?: string; photoId: string; idempotencyKey?: string }
export interface UpdateRatingInput { score?: number; note?: string | null; tastedAt?: string; photoId?: string }
export interface ItemFilters { search?: string; brand?: string; type?: string; sort?: 'recent' | 'score' | 'name' | 'most-rated'; limit?: number; offset?: number }
export interface GroupPatch { name?: string; ownerId?: string; leave?: boolean }
export interface RecognitionSuggestion { name: string; brand: string | null; variant: string | null; type: string | null; broadCategory: string | null; confidence: number }
export interface RecognitionResult { status: 'completed' | 'failed'; suggestion: RecognitionSuggestion | null; matches: Item[]; message?: string }
export interface UploadedPhoto { id: string; mimeType: string; width: number; height: number }
export interface UpdateItemInput { name?: string; brand?: string | null; variant?: string | null; type?: string | null; broadCategory?: string | null }
export interface UpdateCommentInput { body: string }

export interface UpdatePreferencesInput { aiEnabled: boolean }
