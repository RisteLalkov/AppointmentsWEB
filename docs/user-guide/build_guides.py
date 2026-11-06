#!/usr/bin/env python3
"""Build the two Word guides from the adjacent Markdown and example screenshots.

Requires python-docx, Pillow, and DejaVu fonts. No app, API, or database access.
Optional pages-en.json/pages-mk.json maps can override the checked page numbers
if later content edits change pagination. Word also updates the page fields.
"""
from pathlib import Path
import re, json
from docx import Document
from docx.shared import Inches, Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont

WORK=Path(__file__).resolve().parent
OUT=WORK
ASSETS=WORK/'assets'
ASSETS.mkdir(exist_ok=True,parents=True)
TEAL='087969'; DARK='173B36'; MUTED='566D72'; LIGHT='E9F5F0'; LINE='D9E5E2'
FONT='Arial'
MAXWIDTH=6.85

# Branded workflow illustrations; no product screen or record is altered.
fontroot=Path('/usr/share/fonts/truetype/dejavu')
for lang in ['en','mk']:
 labels=([('1','Browse','public information'),('2','Choose','doctor and service'),('3','Sign in','or create an account'),('4','Review','date, time, patient'),('5','Save','check the result'),('6','Follow up','status and changes')] if lang=='en' else [('1','Пребарајте','јавни информации'),('2','Изберете','лекар и услуга'),('3','Најавете се','или регистрирајте се'),('4','Проверете','датум, час, пациент'),('5','Зачувајте','прочитајте го исходот'),('6','Следете','статус и промени')])
 im=Image.new('RGB',(1500,450),'white');d=ImageDraw.Draw(im)
 bold=ImageFont.truetype(str(fontroot/'DejaVuSans-Bold.ttf'),30);small=ImageFont.truetype(str(fontroot/'DejaVuSans.ttf'),21)
 for i,(num,title,sub) in enumerate(labels):
  x=18+(i%3)*500;y=15+(i//3)*220
  d.rounded_rectangle((x,y,x+465,y+190),radius=22,fill='#edf6f2',outline='#bdd9cf',width=2)
  d.rounded_rectangle((x+20,y+20,x+75,y+75),radius=16,fill='#087969');d.text((x+39,y+28),num,font=bold,fill='white',anchor='mt')
  d.text((x+98,y+32),title,font=bold,fill='#173b36');d.text((x+25,y+117),sub,font=small,fill='#45645b')
  if i%3<2:
   d.line((x+470,y+94,x+491,y+94),fill='#087969',width=4);d.polygon([(x+491,y+94),(x+482,y+87),(x+482,y+101)],fill='#087969')
 im.save(ASSETS/f'flow-{lang}.png')


def rich(p,text,size=None,color=None):
 for part in re.split(r'(\*\*.*?\*\*)',text):
  if not part:continue
  r=p.add_run(part[2:-2] if part.startswith('**') and part.endswith('**') else part)
  if part.startswith('**'):r.bold=True
  if size:r.font.size=Pt(size)
  if color:r.font.color.rgb=RGBColor.from_string(color)
 return p

def shade(cell,fill):
 pr=cell._tc.get_or_add_tcPr();e=OxmlElement('w:shd');e.set(qn('w:fill'),fill);pr.append(e)
def borders(table):
 pr=table._tbl.tblPr;e=OxmlElement('w:tblBorders')
 for k in ['top','left','bottom','right','insideH','insideV']:
  x=OxmlElement('w:'+k);x.set(qn('w:val'),'single');x.set(qn('w:sz'),'4');x.set(qn('w:color'),LINE);e.append(x)
 pr.append(e)
 margins=OxmlElement('w:tblCellMar')
 for k in ['top','left','bottom','right']:
  a=OxmlElement('w:'+k);a.set(qn('w:w'),'90');a.set(qn('w:type'),'dxa');margins.append(a)
 pr.append(margins)

def table(doc,rows):
 n=len(rows[0]);t=doc.add_table(rows=0,cols=n);t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=False
 if n==4:fractions=[.24,.25,.25,.26]
 elif n==3:fractions=[.28,.37,.35]
 else:fractions=[.30,.70]
 for col,part in zip(t.columns,fractions):col.width=Inches(MAXWIDTH*part)
 for i,values in enumerate(rows):
  cells=t.add_row().cells
  for j,(c,v) in enumerate(zip(cells,values)):
   c.width=Inches(MAXWIDTH*fractions[j]);c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.TOP
   p=c.paragraphs[0];p.paragraph_format.space_after=Pt(2);p.paragraph_format.line_spacing=1.08
   rich(p,v,9.5 if n==4 else 10.2,'FFFFFF' if i==0 else DARK)
   if i==0:
    shade(c,TEAL)
    for r in p.runs:r.bold=True
   elif i%2==0:shade(c,'F3F8F6')
  trpr=t.rows[-1]._tr.get_or_add_trPr();flag=OxmlElement('w:cantSplit');trpr.append(flag)
  if i==0:flag=OxmlElement('w:tblHeader');trpr.append(flag)
 borders(t)
 doc.add_paragraph().paragraph_format.space_after=Pt(1)
 return t

def note(doc,text):
 t=doc.add_table(rows=1,cols=1);t.autofit=False;t.columns[0].width=Inches(MAXWIDTH)
 shade(t.cell(0,0),LIGHT);borders(t)
 p=t.cell(0,0).paragraphs[0];p.paragraph_format.space_after=Pt(3);rich(p,text,10.5,DARK)
 doc.add_paragraph().paragraph_format.space_after=Pt(1)

def bookmark(p,name,idx):
 a=OxmlElement('w:bookmarkStart');a.set(qn('w:id'),str(idx));a.set(qn('w:name'),name);p._p.insert(0,a)
 b=OxmlElement('w:bookmarkEnd');b.set(qn('w:id'),str(idx));p._p.append(b)

def field(p,instruction,value):
 r=OxmlElement('w:r');a=OxmlElement('w:fldChar');a.set(qn('w:fldCharType'),'begin');r.append(a);p._p.append(r)
 r=OxmlElement('w:r');a=OxmlElement('w:instrText');a.set(qn('xml:space'),'preserve');a.text=' '+instruction+' ';r.append(a);p._p.append(r)
 r=OxmlElement('w:r');a=OxmlElement('w:fldChar');a.set(qn('w:fldCharType'),'separate');r.append(a);p._p.append(r)
 p.add_run(str(value))
 r=OxmlElement('w:r');a=OxmlElement('w:fldChar');a.set(qn('w:fldCharType'),'end');r.append(a);p._p.append(r)

def toc_row(doc,title,idx,page):
 t=doc.add_table(rows=1,cols=2);t.autofit=False;t.columns[0].width=Inches(6.3);t.columns[1].width=Inches(.55)
 p=t.cell(0,0).paragraphs[0];p.paragraph_format.space_after=Pt(6)
 h=OxmlElement('w:hyperlink');h.set(qn('w:anchor'),f'chapter_{idx:02}')
 rr=OxmlElement('w:r');rp=OxmlElement('w:rPr');co=OxmlElement('w:color');co.set(qn('w:val'),TEAL);rp.append(co);rr.append(rp);tx=OxmlElement('w:t');tx.text=title;rr.append(tx);h.append(rr);p._p.append(h)
 p=t.cell(0,1).paragraphs[0];p.alignment=WD_ALIGN_PARAGRAPH.RIGHT;p.paragraph_format.space_after=Pt(6);field(p,f'PAGEREF chapter_{idx:02} \\h',page)
 for c in t.rows[0].cells:
  for pp in c.paragraphs:
   for r in pp.runs:r.font.size=Pt(10.3)


def parse(text):
 parts=re.split(r'^## (\d{2}) \| (.+)\n',text,flags=re.M)
 intro=parts[0]
 return intro,[(int(parts[i]),parts[i+1],parts[i+2].strip()) for i in range(1,len(parts),3)]

for lang in ['en','mk']:
 source=WORK/('MedTermin-User-Guide-'+lang.upper()+'.md');intro,chapters=parse(source.read_text(encoding='utf-8'))
 doc=Document();s=doc.sections[0];s.page_width=Mm(210);s.page_height=Mm(297);s.top_margin=Mm(19);s.bottom_margin=Mm(19);s.left_margin=Mm(18);s.right_margin=Mm(18);s.header_distance=Mm(8);s.footer_distance=Mm(8)
 styles=doc.styles
 for st in ['Normal','Body Text','List Bullet','List Number']:
  styles[st].font.name=FONT;styles[st].font.size=Pt(11)
  styles[st].paragraph_format.line_spacing=1.13;styles[st].paragraph_format.space_after=Pt(7)
  styles[st].paragraph_format.widow_control=True
 for st,sz in [('Title',40),('Subtitle',18),('Heading 1',24),('Heading 2',14),('Heading 3',11.5)]:
  styles[st].font.name=FONT;styles[st].font.size=Pt(sz);styles[st].font.color.rgb=RGBColor.from_string(DARK if st!='Heading 2' else TEAL)
  styles[st].paragraph_format.space_after=Pt(12);styles[st].paragraph_format.keep_with_next=True
 styles['Caption'].font.name=FONT;styles['Caption'].font.size=Pt(9);styles['Caption'].font.color.rgb=RGBColor.from_string(MUTED)
 default=styles['Normal'].element.get_or_add_rPr();l=OxmlElement('w:lang');l.set(qn('w:val'),'mk-MK' if lang=='mk' else 'en-GB');default.append(l)
 settings=doc.settings.element;e=OxmlElement('w:updateFields');e.set(qn('w:val'),'true');settings.append(e)
 header=s.header.paragraphs[0];header.text='МедТермин  /  '+('ПРИРАЧНИК ЗА КОРИСТЕЊЕ' if lang=='mk' else 'PRACTICAL USER GUIDE');header.style='Caption';header.paragraph_format.space_after=Pt(3)
 foot=s.footer.paragraphs[0];foot.alignment=WD_ALIGN_PARAGRAPH.RIGHT
 rich(foot,('CODEX • 6 ноември 2026  |  Страница ' if lang=='mk' else 'CODEX • 6 November 2026  |  Page '),8.5,MUTED);field(foot,'PAGE','1')
 cp=doc.core_properties;cp.author='CODEX';cp.title='МедТермин — '+('Прирачник за користење' if lang=='mk' else 'Practical user guide');cp.subject='Application workflows, navigation, roles and everyday tasks';cp.keywords='МедТермин; MedTermin; user guide; Macedonian; English';cp.comments='Reviewed against 9c83651. Illustrations contain local demonstration/example data only.'
 # Cover
 doc.add_paragraph('\n\n')
 p=doc.add_paragraph();rich(p,'МЕДТЕРМИН',14,TEAL)
 p=doc.add_paragraph('Прирачник\nза користење' if lang=='mk' else 'Your complete\nuser guide','Title')
 p=doc.add_paragraph('Од првото пребарување\nдо секојдневната работа во клиниката.' if lang=='mk' else 'From the first search\nto everyday work in the clinic.','Subtitle');p.paragraph_format.space_after=Pt(22)
 note(doc,'Јасни постапки • Сите кориснички улоги • Практични примери' if lang=='mk' else 'Clear walkthroughs • Every user role • Practical examples')
 doc.add_paragraph('\n')
 doc.add_picture(str(ASSETS/f'flow-{lang}.png'),width=Inches(MAXWIDTH))
 doc.add_paragraph('\n')
 p=doc.add_paragraph();rich(p,'Посетители  •  Пациенти  •  Лекари\nРецепција  •  Компаниска администрација' if lang=='mk' else 'Visitors  •  Patients  •  Doctors\nReception  •  Company administration',12,DARK)
 doc.add_paragraph('Македонско издание · 6 ноември 2026' if lang=='mk' else 'English edition · 6 November 2026',style='Caption')
 doc.add_paragraph('Развиено од CODEX  •  medtermin.mk' if lang=='mk' else 'Developed by CODEX  •  medtermin.mk',style='Caption')
 # Readable, clickable contents on two pages.
 mappingfile=WORK/f'pages-{lang}.json';mapping=json.loads(mappingfile.read_text()) if mappingfile.exists() else {str(i):i+3 for i in range(1,33)}
 for chunk in [chapters[:16],chapters[16:]]:
  doc.add_page_break();doc.add_heading('Содржина' if lang=='mk' else 'Contents',0)
  if chunk[0][0]==1:
   doc.add_paragraph('Кликнете на наслов за премин во Word. За брзо снаоѓање користете го и панелот за навигација.' if lang=='mk' else 'Click a heading to jump there in Word. You can also use Word’s Navigation Pane.')
  for idx,title,body in chunk:toc_row(doc,f'{idx:02}  {title}',idx,mapping.get(str(idx),'—'))
  if chunk[0][0]==17:
   doc.add_heading('Од каде да почнам?' if lang=='mk' else 'Where should I begin?',2)
   table(doc,[['Улога','Препорачано читање'] if lang=='mk' else ['Role','Suggested reading'],['Пациент' if lang=='mk' else 'Patient','01–13, 28–32'],['Лекар' if lang=='mk' else 'Doctor','01–04, 09–12, 15–19, 21, 28–32'],['Рецепција' if lang=='mk' else 'Reception','01–04, 09–25, 28–32'],['Компаниски администратор' if lang=='mk' else 'Company administrator','01–04, 26–32']])
 # Chapters
 figures=[]
 for idx,title,body in chapters:
  doc.add_page_break();h=doc.add_heading(f'{idx:02}  {title}',1);bookmark(h,f'chapter_{idx:02}',idx)
  lines=body.splitlines();i=0
  while i<len(lines):
   line=lines[i].strip()
   if not line:i+=1;continue
   if line.startswith('!['):
    m=re.match(r'!\[(.*?)\]\((.*?)\)',line);figures.append((idx,m[1],m[2]));
    p=doc.add_paragraph(style='Caption');rich(p,('Илустрација: ' if lang=='mk' else 'Illustration: ')+m[1]+(' — видете го илустрираниот преглед при крајот.' if lang=='mk' else ' — see the illustrated walkthrough at the end.'))
    i+=1;continue
   if line.startswith('|'):
    rows=[]
    while i<len(lines) and lines[i].strip().startswith('|'):
     row=[v.strip() for v in lines[i].strip().strip('|').split('|')]
     if not all(re.fullmatch(r'[-: ]+',v or '-') for v in row):rows.append(row)
     i+=1
    table(doc,rows);continue
   if line.startswith('> '):note(doc,line[2:]);i+=1;continue
   if line.startswith('- '):p=doc.add_paragraph(style='List Bullet');rich(p,line[2:]);i+=1;continue
   if re.match(r'^\d+\. ',line):
    # Explicit labels keep separate task sequences independent.
    p=doc.add_paragraph();p.paragraph_format.left_indent=Mm(4);p.paragraph_format.first_line_indent=Mm(-4);rich(p,line);i+=1;continue
   p=doc.add_paragraph();rich(p,line);i+=1
 # Illustrations: large separate pages keep the procedures readable and the pictures useful.
 doc.add_page_break();doc.add_heading('Илустриран преглед' if lang=='mk' else 'Illustrated walkthrough',1)
 doc.add_paragraph('Следните слики ја покажуваат вистинската структура на тековниот интерфејс. Содржат примерни податоци; ознаката Демо означува обука. Сликите се на македонски, првичниот јазик на апликацијата.' if lang=='mk' else 'The following images show the current interface structure with example data. A Demo label identifies training use. Screens are in Macedonian, the application’s default language.')
 doc.add_paragraph('Користете ги за ориентација и вратете се на наведеното поглавје за целосната постапка. При читање во Word може да ја зголемите сликата.' if lang=='mk' else 'Use them to locate controls, then return to the referenced chapter for the full procedure. Zoom in when reading in Word if you need a closer view.')
 # Each figure is given its own page; several large landscape panels remain legible.
 for j,(idx,label,rel) in enumerate(figures,1):
  doc.add_page_break();p=doc.add_heading((f'Слика {j:02}  |  ' if lang=='mk' else f'Figure {j:02}  |  ')+label,2)
  doc.add_paragraph((f'Поврзано поглавје: {idx:02}. Примерен екран, без вистински пациентски податоци.' if lang=='mk' else f'Related chapter: {idx:02}. Example screen; no real patient information.'),style='Caption')
  path=WORK/rel;im=Image.open(path);w,h=im.size
  width=min(MAXWIDTH,w/112);height=width*h/w
  if height>8.35:height=8.35;width=height*w/h
  picp=doc.add_paragraph();picp.alignment=WD_ALIGN_PARAGRAPH.CENTER;picp.add_run().add_picture(str(path),width=Inches(width),height=Inches(height))
  doc.add_paragraph(('Прочитајте ги објаснувањата и ограничувањата во поглавјето; сликата сама по себе не значи зачувана постапка.' if lang=='mk' else 'Read the chapter’s explanations and limits; a screenshot by itself does not mean an action has been saved.'),style='Caption')
 # Public-facing metadata, no operational secrets or credentials.
 p=doc.add_paragraph('Опфат: тековна апликација, 6 ноември 2026. Примерите служат за обука.' if lang=='mk' else 'Scope: current application, 6 November 2026. Examples are for training.',style='Caption')
 name='MedTermin-User-Guide-'+lang.upper()
 target=OUT/(name+'.docx');doc.save(target)
 print(target, 'paragraphs',len(doc.paragraphs),'tables',len(doc.tables),'figures',len(figures))
