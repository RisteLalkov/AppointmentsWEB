"""Offline integrity inventory. Advisory review is separate from hash validation."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
for asset in json.loads((root/'deployment/vendored-assets.json').read_text()):
 file=root/asset['path']
 assert file.is_file(),f"Missing vendored asset: {file}"
 assert hashlib.sha256(file.read_bytes()).hexdigest()==asset['sha256'],f"Unreviewed vendor change: {file}"
 assert (root/asset['license']).is_file(),f"Missing license: {asset['license']}"
 assert asset['version'] in file.read_text()[:200],f"Unexpected vendor version: {file}"
 print('PASS vendor integrity:',asset['name'],asset['version'])
