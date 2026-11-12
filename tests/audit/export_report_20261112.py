"""Render retained Markdown to printable HTML and DOCX; no application connection."""
import pathlib,sys,re
sys.path.insert(0,'/workspace/.setup/qa-doc-libs')
from markdown_it import MarkdownIt
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.text.run import Run
from urllib.parse import urljoin
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'docs/audit/2026-11-12';stem='PRODUCTION_READINESS_QA_REPORT';source=(OUT/(stem+'.md')).read_text();md=MarkdownIt('commonmark').enable('table');body=md.render(source)
css='''@page{size:A4;margin:19mm 16mm 20mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans",sans-serif;color:#183d36;font-size:10.2pt;line-height:1.5;margin:0}h1{font-size:27pt;line-height:1.16;letter-spacing:-.7px;margin:0 0 22px;color:#087a6d}h2{font-size:18pt;line-height:1.22;margin:30px 0 15px;border-top:2px solid #c6e0da;padding-top:14px;break-after:avoid}h3{font-size:13.3pt;color:#076b60;margin:24px 0 10px;break-after:avoid}p{margin:9px 0}a{color:#087b71;text-decoration:none}table{border-collapse:collapse;width:100%;font-size:8.8pt;margin:15px 0 20px;table-layout:fixed}thead{display:table-header-group}th{background:#145248;color:#fff;text-align:left;font-weight:700}th,td{border:1px solid #d7e2df;padding:7px 8px;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f3f8f6}strong{color:#133c33}li{margin:5px 0}code{font:8.9pt "DejaVu Sans Mono",monospace;overflow-wrap:anywhere}pre{background:#f0f6f4;padding:15px;border:1px solid #d7e2df;border-radius:7px;line-height:1.65;white-space:pre-wrap;break-inside:avoid}pre code{font-size:8pt}.stamp{font-size:9pt;letter-spacing:1.7px;color:#56716b;font-weight:700;margin-bottom:18px}.summary{background:#fff3ed;border-left:5px solid #b35828;padding:12px 16px;margin:18px 0;font-size:11pt}.summary strong{color:#933e1b}@media screen{body{max-width:1000px;padding:50px;margin:auto;background:white}html{background:#edf4f1}}'''
body='<div class="stamp">MEDTERMIN · ENGINEERING QUALITY ASSURANCE · 12 NOV 2026</div>'+body
body=body.replace('<h2>1. Decision', '<div class="summary"><strong>RELEASE VERDICT: NOT READY</strong><br>Core workflows passed; a reproduced staff-workspace performance issue and remaining acceptance work block unrestricted release.</div><h2>1. Decision',1)
html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Appointments — Production Readiness & QA</title><base href="https://github.com/RisteLalkov/AppointmentsWEB/blob/main/docs/audit/2026-11-12/"><style>'+css+'</style></head><body>'+body+'</body></html>'
(OUT/(stem+'.html')).write_text(html)
doc=Document();sec=doc.sections[0];sec.page_width=Inches(8.2677);sec.page_height=Inches(11.6929);sec.top_margin=Inches(.7);sec.bottom_margin=Inches(.7);sec.left_margin=Inches(.7);sec.right_margin=Inches(.7)
styles=doc.styles
for name in ['Normal','Body Text','List Bullet','List Number']:
 styles[name].font.name='Arial';styles[name].font.size=Pt(10)
styles['Normal'].paragraph_format.space_after=Pt(6)
for name,size in [('Title',25),('Heading 1',18),('Heading 2',13),('Heading 3',11)]:styles[name].font.name='Arial';styles[name].font.size=Pt(size);styles[name].font.color.rgb=RGBColor.from_string('087A6D')
header=sec.header.paragraphs[0];header.text='МЕДТЕРМИН  /  PRODUCTION READINESS & QA';header.style='Caption'
footer=sec.footer.paragraphs[0];footer.text='Audit revision 08bd3d6 · 12 November 2026                                   Page '
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field);footer.style='Caption'
doc.core_properties.title='APPOINTMENTS — PRODUCTION READINESS & QA REPORT';doc.core_properties.subject='Pre-release audit of MedТермин';doc.core_properties.author='Engineering QA audit'
def inline(par,tokens):
 bold=False;italic=False;link=None
 for t in tokens or []:
  if t.type=='strong_open':bold=True
  elif t.type=='strong_close':bold=False
  elif t.type=='em_open':italic=True
  elif t.type=='em_close':italic=False
  elif t.type=='link_open':link=t.attrGet('href')
  elif t.type=='link_close':link=None
  elif t.type in ['text','code_inline','softbreak','hardbreak']:
   content='\n' if t.type in ['softbreak','hardbreak'] else t.content
   if link:
    url=urljoin('https://github.com/RisteLalkov/AppointmentsWEB/blob/main/docs/audit/2026-11-12/',link)
    if url.endswith('/'):url=url.replace('/blob/main/','/tree/main/')
    h=OxmlElement('w:hyperlink');h.set(qn('r:id'),par.part.relate_to(url,RT.HYPERLINK,is_external=True));xmlrun=OxmlElement('w:r');h.append(xmlrun);par._p.append(h);r=Run(xmlrun,par);r.text=content
   else:r=par.add_run(content)
   r.bold=bold;r.italic=italic
   if t.type=='code_inline':r.font.name='Consolas';r.font.size=Pt(9)
   if link:r.font.color.rgb=RGBColor.from_string('087A6D');r.underline=True
tokens=md.parse(source);i=0;list_stack=[]
while i<len(tokens):
 t=tokens[i]
 if t.type=='heading_open':
  level=int(t.tag[1]);par=doc.add_paragraph(style='Title' if level==1 else 'Heading '+str(min(3,level-1)));inline(par,tokens[i+1].children);i+=3;continue
 if t.type in ['bullet_list_open','ordered_list_open']:list_stack.append(t.type)
 elif t.type in ['bullet_list_close','ordered_list_close']:list_stack.pop()
 elif t.type=='paragraph_open':
  style='List Number' if list_stack and list_stack[-1]=='ordered_list_open' else 'List Bullet' if list_stack else 'Normal';par=doc.add_paragraph(style=style);inline(par,tokens[i+1].children);i+=3;continue
 elif t.type=='fence':
  par=doc.add_paragraph();run=par.add_run(t.content);run.font.name='Consolas';run.font.size=Pt(8)
 elif t.type=='table_open':
  rows=[];header_rows=0;i+=1
  while tokens[i].type!='table_close':
   if tokens[i].type=='thead_open':header_rows=1
   if tokens[i].type=='tr_open':rows.append([])
   if tokens[i].type in ['th_open','td_open']:rows[-1].append(tokens[i+1].children)
   i+=1
  table=doc.add_table(rows=len(rows),cols=max(len(r) for r in rows));table.style='Table Grid';table.autofit=True
  for ri,row in enumerate(rows):
   trpr=table.rows[ri]._tr.get_or_add_trPr();trpr.append(OxmlElement('w:cantSplit'))
   if ri==0:trpr.append(OxmlElement('w:tblHeader'))
   for ci,items in enumerate(row):
    cell=table.cell(ri,ci);inline(cell.paragraphs[0],items)
    for par in cell.paragraphs:
     for run in par.runs:run.font.size=Pt(8.5)
    if ri==0:
     shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'145248');cell._tc.get_or_add_tcPr().append(shade)
     for run in cell.paragraphs[0].runs:run.font.color.rgb=RGBColor(255,255,255);run.bold=True
  doc.add_paragraph()
 i+=1
doc.save(OUT/(stem+'.docx'))
print('Rendered HTML and Word report.')
