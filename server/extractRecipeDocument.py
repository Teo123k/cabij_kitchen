import sys, subprocess, zipfile, xml.etree.ElementTree as ET
path, ext = sys.argv[1:3]
if ext == 'pdf':
    result = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, timeout=20, check=True)
    text = result.stdout.decode('utf-8')
elif ext == 'docx':
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo('word/document.xml')
        if info.file_size > 4000000:
            raise ValueError('Word document is too large.')
        root = ET.fromstring(archive.read(info))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraph = lambda p: ''.join(t.text or '' for t in p.findall('.//w:t', ns))
        blocks = []
        for block in root.find('w:body', ns):
            if block.tag.endswith('}tbl'):
                for row in block.findall('w:tr', ns):
                    blocks.append('  '.join(' '.join(paragraph(p) for p in cell.findall('.//w:p', ns)) for cell in row.findall('w:tc', ns)))
            else:
                blocks.append(paragraph(block))
        text = '\n'.join(blocks)
else:
    text = open(path, encoding='utf-8-sig').read()
if len(text) > 150000:
    raise ValueError('Document text exceeds 150,000 characters. Split it into individual recipes.')
if not text.strip():
    raise ValueError('No readable text found. This may be a scanned PDF; use a text PDF or Word document.')
print(text)
