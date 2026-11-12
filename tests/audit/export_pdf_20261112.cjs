// Print only the retained audit document. A loopback server avoids prohibited file-scheme navigation.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(__dirname,'../../docs/audit/2026-11-12'),html=fs.readFileSync(dir+'/PRODUCTION_READINESS_QA_REPORT.html');
 const server=http.createServer((_,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.pdf({path:dir+'/PRODUCTION_READINESS_QA_REPORT.pdf',format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;color:#60766d;padding:0 60px;width:100%;display:flex;justify-content:space-between"><span>МедТермин · QA audit · revision 08bd3d6</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',margin:{top:'19mm',bottom:'20mm',left:'16mm',right:'16mm'}});
  await page.setViewportSize({width:1150,height:1000});await page.screenshot({path:dir+'/screenshots/report-preview.png'});
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
