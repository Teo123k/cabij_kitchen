# Only workflow metadata and execution results are read. Credentials are never queried.
import json, sqlite3, sys
from pathlib import Path
path = Path(sys.argv[1]).expanduser().resolve()
workflow_id = sys.argv[2]
execution_id = sys.argv[3] if len(sys.argv) > 3 else None
with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5) as db:
    row = db.execute('SELECT id,name,active,nodes FROM workflow_entity WHERE id=?', (workflow_id,)).fetchone()
    if row is None:
        raise RuntimeError('Configured WF1 workflow was not found.')
    nodes = json.loads(row[3])
    if not any(n.get('name') == 'WF1 Final Contract Output' for n in nodes):
        raise RuntimeError('WF1 has no final recipe contract node. Review its output wiring.')
    query = 'SELECT e.id,e.startedAt,e.status,d.data FROM execution_entity e JOIN execution_data d ON d.executionId=e.id WHERE e.workflowId=? AND e.deletedAt IS NULL'
    args = [workflow_id]
    if execution_id:
        query += ' AND e.id=?'; args.append(execution_id)
    query += ' ORDER BY e.id DESC LIMIT 20'
    executions = [{'id':str(r[0]),'startedAt':r[1],'status':r[2],'data':r[3]} for r in db.execute(query,args) if len(r[3] or '') < 5000000]
    print(json.dumps({'workflow':{'id':row[0],'name':row[1],'active':bool(row[2])},'executions':executions}))
