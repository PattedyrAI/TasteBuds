"""Resumable archive staging tests; no production connections."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.parse import urlparse, unquote
from uuid import uuid4

spec=importlib.util.spec_from_file_location('resumable',Path(__file__).parents[1]/'scripts/promote-resumable.py')
r=importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

def blob(data,stamp='2026-01-02 03:04:05.123456+00'):
    sha=hashlib.sha256(data).hexdigest()
    return f'{sha}\t{len(data)}\t\\\\x{data.hex()}\t{stamp}\n'.encode()

class PureTests(unittest.TestCase):
    def test_blob_parser_preserves_bytes_and_microseconds(self):
        line=blob(b'\x00\x01\xff'); entry=r.parse_blob(line)
        self.assertEqual(entry,{'sha256':hashlib.sha256(b'\x00\x01\xff').hexdigest(),'byte_size':3,'created_at':'2026-01-02T03:04:05.123456Z'})
        for bad in [line.replace(b'\t3\t',b'\t4\t'),b'0'*64+line[64:],line[:-2]+b'X\n']:
            with self.assertRaises(r.p.GuardError):r.parse_blob(bad)
    def test_batches_bound_text_and_do_not_drop_last_row(self):
        rows=[blob(bytes([n])*n) for n in range(1,8)]
        batches=list(r.batches(iter(rows),max_bytes=350))
        self.assertEqual([row for batch in batches for row in batch],rows)
        self.assertTrue(all(sum(map(len,batch))<=350 for batch in batches))
        with self.assertRaises(r.p.GuardError):list(r.batches([b'x'*351],max_bytes=350))
    def test_resume_rejects_wrong_hash_size_timestamp_or_unknown_rows(self):
        source=[r.parse_blob(blob(b'abc'))]; actual=[dict(source[0],actual_sha256=source[0]['sha256'],actual_bytes=3)]
        self.assertEqual(r.validate_loaded(actual,source),{source[0]['sha256']})
        for field,value in [('actual_sha256','0'*64),('actual_bytes',4),('byte_size',4),('created_at','2000-01-01T00:00:00.000000Z'),('sha256','0'*64)]:
            bad=[dict(actual[0],**{field:value})]
            with self.assertRaises(r.p.GuardError):r.validate_loaded(bad,source)
    def test_toc_excludes_only_blob_table_and_data(self):
        toc='1; 0 1 SCHEMA - everrate user\n2; 0 2 TABLE everrate archive_blobs user\n3; 0 3 TABLE DATA everrate archive_blobs user\n4; 0 4 CONSTRAINT everrate archive_blobs archive_blobs_pkey user\n5; 0 5 TABLE everrate archive_files user\n'
        selected=r.select_toc(toc)
        self.assertNotIn('2;',selected);self.assertNotIn('3;',selected);self.assertIn('4;',selected);self.assertIn('5;',selected)
    def test_data_section_header_filter_preserves_every_payload_byte(self):
        source=b'-- Header\nSET transaction_timeout = 0;\n-- Data for Name: archive_files; Type: TABLE DATA\nCOPY everrate.archive_files FROM stdin;\nSET transaction_timeout = 0;\n\\.\n'
        self.assertEqual(b''.join(r.filter_section(io.BytesIO(source))),source.replace(b'SET transaction_timeout = 0;\n',b'',1))
        with self.assertRaises(r.p.GuardError):list(r.filter_section(io.BytesIO(source.replace(b'SET transaction_timeout = 0;\n',b'',1))))
    def test_definition_change_fails_closed(self):
        self.assertIn('CREATE TABLE '+r.STAGE+'.archive_blobs',r.stage_definition(r.BLOB_DDL))
        with self.assertRaises(r.p.GuardError):r.stage_definition(r.BLOB_DDL.replace('bytea NOT NULL','text NOT NULL'))

@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'),'Disposable local TEST_DATABASE_URL required')
class PostgreSQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url=urlparse(os.environ['TEST_DATABASE_URL'])
        if url.hostname not in ('localhost','127.0.0.1','::1') or not url.path.endswith('_test') or url.query:
            raise RuntimeError('Local disposable URL required')
        cls.database='everrate_resumable_'+uuid4().hex+'_test'
        cls.env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        cls.env.update(PGHOST=url.hostname,PGPORT=str(url.port or 5432),PGUSER=unquote(url.username or ''),PGDATABASE=cls.database)
        if url.password:cls.env['PGPASSWORD']=unquote(url.password)
        subprocess.run([str(r.p.PG_BIN/'createdb'),'--maintenance-db=postgres',cls.database],env=cls.env,check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):
        subprocess.run([str(r.p.PG_BIN/'dropdb'),'--maintenance-db=postgres',cls.database],env=cls.env,check=True,capture_output=True)
    def sql(self,sql):
        result=subprocess.run([str(r.p.PG_BIN/'psql'),'-X','-q','-A','-t','--set','ON_ERROR_STOP=1','--file=-'],input=sql.encode(),env=self.env,check=True,capture_output=True)
        return result.stdout.decode().strip()
    def setUp(self):
        self.sql('DROP SCHEMA IF EXISTS everrate CASCADE; DROP SCHEMA IF EXISTS '+r.STAGE+' CASCADE; DROP TABLE IF EXISTS public.legacy_probe; CREATE TABLE public.legacy_probe(id integer PRIMARY KEY,note text); INSERT INTO public.legacy_probe VALUES(1,\'original\');')
        self.rows=[blob(b'abc'),blob(b'\x00\xffpayload')]
        self.manifest=sorted([r.parse_blob(row) for row in self.rows],key=lambda row:row['sha256'])
        self.binding={'version':1,'dumpSha256':'a'*64,'definitionSha256':hashlib.sha256(r.BLOB_DDL.encode()).hexdigest(),'manifestSha256':r.digest(self.manifest),'publicCounts':{'legacy_probe':1},'finalCounts':{'archive_blobs':2,'discord_outbox':0},'blobCount':2,'blobBytes':sum(x['byte_size'] for x in self.manifest),'publicFingerprints':json.loads(self.sql(r.public_fingerprints_sql()))}
    def transaction(self,sql,suffix=b''):
        with tempfile.TemporaryDirectory() as tmp:
            return r.run_sql(sql,self.env,Path(tmp),{'legacy_probe':1},lambda:100,suffix=suffix,timeout=10)
    def test_stage_resume_bad_bytes_binding_and_final_move_rollback(self):
        self.transaction(r.stage_init(self.binding,r.BLOB_DDL))
        self.transaction(r.batch_sql(self.rows[:1],self.binding))
        self.transaction(r.batch_sql(self.rows[:1],self.binding))
        self.assertEqual(self.sql('SELECT count(*) FROM '+r.STAGE+'.archive_blobs'),'1')
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(r.inspect_stage(r.p.Runner(Path(tmp)),self.env,self.binding,self.manifest),{self.manifest[0]['sha256']} if self.manifest[0]['sha256']==r.parse_blob(self.rows[0])['sha256'] else {self.manifest[1]['sha256']})
        changed=dict(self.binding,dumpSha256='b'*64)
        with self.assertRaises(r.p.GuardError):self.transaction(r.batch_sql(self.rows[1:],changed))
        self.transaction(r.batch_sql(self.rows[1:],self.binding))
        before=self.sql('SELECT relfilenode FROM pg_class WHERE oid=\''+r.STAGE+'.archive_blobs\'::regclass')
        move=b'CREATE SCHEMA everrate;'+r.final_move_sql(self.binding)+b'CREATE TABLE everrate.discord_outbox(id integer);'
        with self.assertRaises(r.p.GuardError):self.transaction(move,suffix=b'SELECT 1/0;')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname='everrate'"),'0')
        self.assertEqual(self.sql('SELECT count(*) FROM '+r.STAGE+'.archive_blobs'),'2')
        self.transaction(move,suffix=r.manifest_guard('everrate',self.manifest)+r.p.restored_counts_sql(self.binding['finalCounts']))
        after=self.sql("SELECT relfilenode FROM pg_class WHERE oid='everrate.archive_blobs'::regclass")
        self.assertEqual(before,after)  # metadata move, no bytea table copy
        self.assertEqual(self.sql('SELECT note FROM public.legacy_probe'),'original')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname='"+r.STAGE+"'"),'0')
    def test_real_custom_dump_full_release_restores_foreign_keys_and_preserves_timestamps(self):
        self.sql('CREATE SCHEMA everrate;'+r.BLOB_DDL+' ALTER TABLE everrate.archive_blobs ADD CONSTRAINT archive_blobs_pkey PRIMARY KEY(sha256); CREATE TABLE everrate.discord_outbox(id integer); CREATE TABLE everrate.archive_files(id integer PRIMARY KEY,blob_sha256 text REFERENCES everrate.archive_blobs(sha256));')
        for index,row in enumerate(self.rows):
            fields=row[:-1].split(b'\t')
            self.sql("INSERT INTO everrate.archive_blobs VALUES('"+fields[0].decode()+"',"+fields[1].decode()+",decode('"+fields[2][3:].decode()+"','hex'),'"+fields[3].decode()+"'); INSERT INTO everrate.archive_files VALUES("+str(index)+",'"+fields[0].decode()+"');")
        expected={'archive_blobs':2,'archive_files':2,'discord_outbox':0}
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);dump=folder/'fixture.dump'
            subprocess.run([str(r.p.PG_BIN/'pg_dump'),'-Fc','--schema=everrate','--file='+str(dump)],env=self.env,check=True,capture_output=True)
            source_sha=hashlib.sha256(dump.read_bytes()).hexdigest()
            prepared=folder/'prepared';prepared.mkdir()
            binding,manifest,ddl,verify=r.prepare(dump,prepared,r.p.Runner(prepared),source_sha,{'legacy_probe':1},expected)
            binding['publicFingerprints']=self.binding['publicFingerprints']
            (prepared/'binding.json').write_text(r.canonical(binding))
            self.sql('DROP SCHEMA everrate CASCADE;')
            self.transaction(r.stage_init(binding,ddl))
            extracted=list(r.blob_rows(dump,prepared))
            self.transaction(r.batch_sql(extracted,binding))
            old_oid=self.sql("SELECT oid FROM pg_class WHERE oid='"+r.STAGE+".archive_blobs'::regclass")
            for fail_final in [True,False]:
                operation=folder/('failure' if fail_final else 'success');operation.mkdir()
                suffix=r.public_guard(binding)+r.p.guard_sql({'legacy_probe':1},before=False)+r.p.restored_counts_sql(expected)+r.manifest_guard('everrate',manifest)
                if fail_final:suffix+=b'SELECT 1/0;'
                def perform():
                    return r.p.stream_transaction([os.sys.executable,str(Path(r.__file__).resolve()),'--emit-final',str(prepared),str(dump)],r.PSQL,self.env,operation,r.p.guard_sql({'legacy_probe':1},before=True),suffix,lambda:100,verify,timeout=20)
                if fail_final:
                    with self.assertRaises(r.p.GuardError):perform()
                    self.assertEqual(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname='everrate'"),'0')
                    self.assertEqual(self.sql('SELECT count(*) FROM '+r.STAGE+'.archive_blobs'),'2')
                else:self.assertTrue(perform())
            self.assertEqual(old_oid,self.sql("SELECT oid FROM pg_class WHERE oid='everrate.archive_blobs'::regclass"))
            actual=json.loads(self.sql(r.blob_evidence_query('everrate')))
            self.assertEqual(r.validate_loaded(actual,manifest),{row['sha256'] for row in manifest})
            self.assertEqual(self.sql("SELECT count(*) FROM pg_constraint WHERE conrelid='everrate.archive_files'::regclass AND contype='f'"),'1')
            self.assertEqual(self.sql("SELECT count(*) FROM pg_constraint WHERE conrelid='everrate.archive_blobs'::regclass AND contype='p'"),'1')
            self.assertEqual(self.sql('SELECT note FROM public.legacy_probe'),'original')

    def test_large_exact_replay_does_not_grow_staged_storage(self):
        row=blob(os.urandom(1024*1024));manifest=[r.parse_blob(row)]
        binding=dict(self.binding,manifestSha256=r.digest(manifest),blobCount=1,blobBytes=1024*1024)
        self.transaction(r.stage_init(binding,r.BLOB_DDL))
        self.transaction(r.batch_sql([row],binding))
        before=self.sql("SELECT pg_total_relation_size('"+r.STAGE+".archive_blobs')")
        for _ in range(3):self.transaction(r.batch_sql([row],binding))
        self.assertEqual(self.sql("SELECT pg_total_relation_size('"+r.STAGE+".archive_blobs')"),before)
        self.assertEqual(self.sql('SELECT count(*) FROM '+r.STAGE+'.archive_blobs'),'1')

    def test_same_count_public_edit_blocks_new_batch(self):
        self.transaction(r.stage_init(self.binding,r.BLOB_DDL))
        self.sql("UPDATE public.legacy_probe SET note='changed'")
        with self.assertRaises(r.p.GuardError):self.transaction(r.batch_sql(self.rows,self.binding))
        self.assertEqual(self.sql('SELECT count(*) FROM '+r.STAGE+'.archive_blobs'),'0')

    def test_invalid_staged_bytes_or_schema_fail_resume(self):
        self.transaction(r.stage_init(self.binding,r.BLOB_DDL))
        self.transaction(r.batch_sql(self.rows,self.binding))
        self.sql("UPDATE "+r.STAGE+".archive_blobs SET data=decode('646566','hex') WHERE byte_size=3")
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(r.p.GuardError):r.inspect_stage(r.p.Runner(Path(tmp)),self.env,self.binding,self.manifest)
        with self.assertRaises(r.p.GuardError):self.transaction(r.batch_sql(self.rows,self.binding))
        self.sql('ALTER TABLE '+r.STAGE+'.archive_blobs ADD COLUMN surprise text')
        with self.assertRaises(r.p.GuardError):self.transaction(r.batch_sql(self.rows,self.binding))

if __name__=='__main__':unittest.main()
