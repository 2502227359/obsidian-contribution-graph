import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// 仅在隔离库操作临时笔记和只读查询，禁止指向正式仓库。
const endpoint=process.env.OBSIDIAN_TEST_CDP||'http://127.0.0.1:9231';
const targets=await(await fetch(endpoint+'/json/list')).json();
const target=targets.find(item=>item.type==='page'&&item.url.startsWith('app://'));
assert.ok(target,'隔离宿主未启动');
const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
socket.onmessage=event=>{const result=JSON.parse(event.data),task=pending.get(result.id);if(!task)return;pending.delete(result.id);result.error?task.reject(result.error):task.resolve(result.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(code){
 const result=await call('Runtime.evaluate',{expression:'window.__graphPolishPromise=Promise.resolve(eval('+JSON.stringify(code)+'))',returnByValue:true,awaitPromise:true,userGesture:true});
 assert.ok(!result.exceptionDetails,result.exceptionDetails?.exception?.description);
 return result.result.value;
}
async function click(selector){
 assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`),selector);await wait(180);
}
async function choose(selector,value){
 await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await wait(300);
}
async function screenshot(name){
 await wait(250);const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('dist/'+name,Buffer.from(result.data,'base64'));
}
function sampleDay(query){
 const today=new Date().toLocaleDateString('sv-SE'),date=query.date;
 const samples=[['a','临床医学/临床医学/妇产科学/女性生殖系统.md',490,545],['b','临床医学/临床医学/妇产科学/妊娠诊断.md',550,580],['a2','临床医学/临床医学/妇产科学/女性生殖系统.md',590,610],['c','临床医学/临床医学/妇产科学/章节/女性生殖系统.md',620,640],['d','临床医学/临床医学/内科学/心力衰竭.md',650,690],['y','activity://yolo-chat',700,720]];
 const start=Date.parse(date+'T00:00:00+08:00');
 const blocks=samples.map(([id,path,from,to])=>{const activity=path.startsWith('activity:'),groupName=activity?'YOLO 对话活动':path.includes('妇产科学')?'妇产科学':'内科学';return{id,segmentIds:[id],sourceId:'sample',continuityId:id,path,start:start+from*60000,end:start+to*60000,seconds:(to-from)*60,startMinute:from,endMinute:to,offsetMinutes:480,groupId:activity?'activity:yolo':'folder:临床医学/临床医学/'+groupName,groupName,activity};});
 return{date,today,totalSeconds:blocks.reduce((sum,b)=>sum+b.seconds,0),locatedSeconds:blocks.reduce((sum,b)=>sum+b.seconds,0),precision:'DETAILED',blocks,warnings:[],recordedDates:[today]};
}
const plugin="app.plugins.plugins['contribution-graph-local']",qa='window.__graphPolishQA';
let initialized=false;const evidence={};const legendOnly=process.argv.includes('--legend-only');
try{
 assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith('/dist/time-acceptance/vault'));
 await evaluate(`(()=>{window.__graphPolishQA={oldLeaf:app.workspace.activeLeaf,originalListeners:new Set(${plugin}.activityService.listeners),fontText:document.body.style.getPropertyValue('--font-text'),fontInterface:document.body.style.getPropertyValue('--font-interface')};document.body.style.setProperty('--font-text','霞鹜文楷等宽');document.body.style.setProperty('--font-interface','霞鹜文楷等宽');return true})()`);initialized=true;
 const content=['# 图表阅读模式验收','','```contributionGraph','title: 学习时间轴','graphType: timeline','dateRangeType: LATEST_DAYS','dateRangeValue: 30','dataSource:','  type: TIME_ACTIVITY','```','','```contributionGraph','title: 原有时长图','graphType: default','dateRangeType: LATEST_DAYS','dateRangeValue: 30','dataSource:','  type: TIME_ACTIVITY','```','',...Array.from({length:50},(_,i)=>'滚动验收段落 '+i+'\n')].join('\n');
 await evaluate(`(async()=>{const q=${qa};q.path='周回顾验收/图表打磨验收-'+Date.now()+'.md';if(!app.vault.getAbstractFileByPath('周回顾验收'))await app.vault.createFolder('周回顾验收');q.file=await app.vault.create(q.path,${JSON.stringify(content)});q.leaf=app.workspace.getLeaf('tab');await q.leaf.openFile(q.file,{state:{mode:'preview'}});return true})()`);await wait(600);
 evidence.firstOpen=await evaluate(`(()=>{const v=${qa}.leaf.view,e=v.previewMode.containerEl;return{mode:v.getMode(),timelines:e.querySelectorAll('.cg-activity-timeline').length,otherGraphs:e.querySelectorAll('.contribution-graph:not(.cg-activity-timeline-graph)').length}})()`);
 assert.equal(evidence.firstOpen.timelines,1,'首次打开阅读模式，时间轴内部组件必须保留');
 assert.equal(evidence.firstOpen.otherGraphs,1,'原有时长图仍显示');
 if(!legendOnly){
 for(const mode of ['source','preview']){
  await evaluate(`(async()=>{await ${qa}.leaf.setViewState({type:'markdown',state:{file:${qa}.path,mode:${JSON.stringify(mode)}}});return true})()`);await wait(450);
  const count=await evaluate(`(()=>{const v=${qa}.leaf.view;return(${JSON.stringify(mode)}==='preview'?v.previewMode.containerEl:v.contentEl.querySelector('.cm-content')).querySelectorAll('.cg-activity-timeline').length})()`);
  assert.equal(count,1,mode+'模式切换后保持一个时间轴');
 }
 await evaluate(`(()=>{const v=${qa}.leaf.view,scroll=v.previewMode.containerEl.querySelector('.markdown-preview-view');scroll.scrollTop=scroll.scrollHeight;return true})()`);await wait(200);
 await evaluate(`${qa}.leaf.view.previewMode.containerEl.querySelector('.markdown-preview-view').scrollTop=0`);await wait(250);
 assert.equal(await evaluate(`${qa}.leaf.view.previewMode.containerEl.querySelectorAll('.cg-activity-timeline').length`),1,'滚动返回后时间轴仍保留');
 }
 await evaluate(`(()=>{const q=${qa},s=${plugin}.activityService;q.service=s;q.timelineQuery=s.getActivityTimelineDay;q.settings=JSON.stringify(s.getSettings());q.totals=JSON.stringify(s.getDailyTimeStats());q.dark=document.body.classList.contains('theme-dark');q.light=document.body.classList.contains('theme-light');s.getActivityTimelineDay=${sampleDay.toString()};q.leaf.view.containerEl.dataset.graphPolish='true';q.timeline=q.leaf.view.previewMode.containerEl.querySelector('.cg-activity-timeline');q.timeline.scrollIntoView({block:'start'});for(const listener of s.listeners)listener({type:'TIME_STATS',source:'TIME_ACTIVITY'});return true})()`);await wait(500);
 const reading='[data-graph-polish=true] .markdown-reading-view ';
 const colors=()=>evaluate(`(()=>{const el=${qa}.timeline,bottom=el.querySelector('.cg-activity-timeline-chart').getBoundingClientRect().bottom;return [...new Set([...el.querySelectorAll('.cg-activity-timeline-chart svg path[fill]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>=8&&r.height<=30&&r.bottom<bottom-40&&e.getAttribute('fill')!=='none'}).map(e=>getComputedStyle(e).fill))].sort()})()`);
 await evaluate(`${qa}.timeline.querySelector('[data-timeline-control=fit]').click()`);await wait(300);
 const palette=await colors();const colorState=await evaluate(`({connected:${qa}.timeline.isConnected,svg:${qa}.timeline.querySelectorAll('svg').length,status:${qa}.timeline.querySelector('.cg-activity-timeline-status').textContent,handler:typeof ${qa}.timeline.querySelector('[data-timeline-control=fit]').onclick,height:${qa}.timeline.clientHeight})`);assert.equal(palette.length,5,'不同活动不再共用单一颜色：'+JSON.stringify({palette,colorState}));
 await evaluate(`${qa}.timeline.querySelector('[data-timeline-group*="妇产科学"]').click()`);await wait(300);
 assert.deepEqual(await colors(),palette,'展开轨道不改变笔记颜色');evidence.activityColors=palette.length;
 await screenshot('graph-polish-timeline.png');
 const legend=()=>evaluate(`(()=>{return [...${qa}.timeline.querySelectorAll('button[data-timeline-group]')].map(button=>{const marker=button.querySelector('.cg-activity-timeline-group-swatch'),style=getComputedStyle(marker);return{id:button.dataset.timelineGroup,multicolor:marker.classList.contains('is-multicolor'),colors:[...new Set(style.backgroundImage==='none'?[style.backgroundColor]:style.backgroundImage.match(/rgba?\\([^)]*\\)/g)||[])]};})})()`);
 const initialLegend=await legend();
 await evaluate(`${qa}.timeline.querySelector('[data-timeline-group*="妇产科学"]').click()`);await wait(250);
 assert.deepEqual(await legend(),initialLegend,'收起轨道不改变真实色标');
 for(const dark of [false,true]){
  await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark})`);await wait(300);
  const markers=await legend(),actual=await colors();
  assert.deepEqual([...new Set(markers.flatMap(marker=>marker.colors))].sort(),actual,'按钮色标与真实轨道色块同源');
  const subject=markers.find(marker=>marker.id.includes('妇产科学')),yolo=markers.find(marker=>marker.id==='activity:yolo');
  assert.equal(subject.multicolor,true);assert.equal(subject.colors.length,3);assert.equal(yolo.multicolor,false);assert.equal(yolo.colors.length,1);
  await screenshot('timeline-legend-'+(dark?'dark':'light')+'.png');
 }
 evidence.legendMatchesTracks=true;
 if(!legendOnly){

 await evaluate(`${qa}.leaf.view.previewMode.containerEl.querySelector('.contribution-graph-codeblock-edit-button').click()`);await wait(350);
 const modal=await evaluate(`(()=>{const el=document.querySelector('.contribution-graph-editor-modal'),inner=el.querySelector('.modal-content'),outerStyle=getComputedStyle(el),innerStyle=getComputedStyle(inner);return{count:document.querySelectorAll('.modal-container').length,outerPadding:outerStyle.padding,innerBorder:innerStyle.borderWidth,innerShadow:innerStyle.boxShadow,font:getComputedStyle(el.querySelector('.cg-editor-shell')).fontFamily}})()`);
 assert.equal(modal.count,1);assert.equal(modal.outerPadding,'0px');assert.equal(modal.innerBorder,'0px');assert.equal(modal.innerShadow,'none');assert.ok(modal.font.includes('霞鹜文楷'));evidence.singleShell=modal;
 for(const type of ['default','month-track','calendar','hourly','timeline']){
  await choose('.contribution-graph-editor-modal select[name=graphType]',type);
  assert.equal(await evaluate("document.querySelectorAll('.contribution-graph-editor-modal').length"),1);
 }
 for(const width of [1200,720,320]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await wait(250);
  const overflow=await evaluate("(()=>{const el=document.querySelector('.contribution-graph-editor-modal');return el.scrollWidth>el.clientWidth+1})()");assert.equal(overflow,false,width+'设置窗口溢出');
  if(width===320)await screenshot('graph-polish-editor-320.png');
 }
 await click('.contribution-graph-editor-modal :is(.modal-close-button,.modal-header-button:has(.lucide-x))');
 await call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{const q=${qa},p=${plugin},base=q.service.getWeeklyReview({},true),day=q.service.getActivityTimelineDay({date:new Date().toLocaleDateString('sv-SE')}),amounts=new Map();for(const b of day.blocks)amounts.set(b.path,(amounts.get(b.path)||0)+b.seconds);const documents=[...amounts].map(([path,seconds])=>({path,seconds}));p.openWeeklyReview();q.weekly=[...p.weeklyReviewModals.values()][0];q.weekly.snapshot={...base,totalSeconds:day.totalSeconds,documents,groups:[],recordedDays:1,days:base.days.map(item=>({...item,seconds:item.date===day.date?day.totalSeconds:0,documents:item.date===day.date?documents:[]}))};q.weekly.render();q.subject='folder:临床医学/临床医学/妇产科学';const seek=(node,id)=>{if(node.id===id)return[node];for(const child of node.children){const found=seek(child,id);if(found)return[node,...found];}return null};q.chain=seek(q.weekly.charts.analysis.tree,q.subject).slice(1).map(node=>node.id);return true})()`);
 const chain=await evaluate(`${qa}.chain`);for(const id of chain)await click('[data-analysis-node='+JSON.stringify(id)+']');
 await click('[data-analysis-node="direct:临床医学/临床医学/妇产科学"]');
 const direct=await evaluate(`({names:[...${qa}.weekly.charts.el.querySelectorAll('[data-analysis-node]')].map(e=>e.dataset.analysisNode),breadcrumb:${qa}.weekly.charts.el.querySelector('.cg-weekly-analysis-hint').textContent})`);
 assert.ok(direct.names.includes('note:临床医学/临床医学/妇产科学/女性生殖系统.md'));assert.ok(direct.names.includes('note:临床医学/临床医学/妇产科学/妊娠诊断.md'));
 await click('[data-analysis-node="note:临床医学/临床医学/妇产科学/妊娠诊断.md"]');
 assert.equal(await evaluate(`${qa}.weekly.chartSelection.documents[0].path`),'临床医学/临床医学/妇产科学/妊娠诊断.md','笔记叶子联动原明细');
 const sums=await evaluate(`(()=>{const check=n=>!n.children.length||Math.abs(n.seconds-n.children.reduce((sum,c)=>sum+c.seconds,0))<1e-6&&n.children.every(check);return check(${qa}.weekly.charts.analysis.tree)})()`);assert.equal(sums,true,'父子时长守恒');
 for(const [width,dark]of [[1200,true],[720,false],[320,false]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark})`);await wait(350);
  const layout=await evaluate(`(()=>{const el=${qa}.weekly.modalEl;return{overflow:el.scrollWidth>el.clientWidth+1,font:getComputedStyle(${qa}.weekly.charts.el).fontFamily}})()`);assert.equal(layout.overflow,false);assert.ok(layout.font.includes('霞鹜文楷'));
  await screenshot('graph-polish-sunburst-'+width+'.png');
 }
 await click('[data-analysis-back]');assert.equal(await evaluate(`${qa}.weekly.charts.focusId`),'folder:临床医学/临床医学/妇产科学');
 await click('[data-analysis-root]');assert.equal(await evaluate(`${qa}.weekly.charts.focusId`),'root');
 evidence.sunburstNotes=true;assert.equal(await evaluate(`JSON.stringify(${qa}.service.getSettings())===${qa}.settings&&JSON.stringify(${qa}.service.getDailyTimeStats())===${qa}.totals`),true,'只读交互不改变真实设置和累计');
 }
 await evaluate(`(()=>{const q=${qa};q.weekly?.close();q.weekly=undefined;q.owned=[...q.service.listeners].filter(listener=>!q.originalListeners.has(listener));q.leaf.detach();q.leaf=undefined;return true})()`);await wait(150);
 evidence.released=await evaluate(`${qa}.owned.every(listener=>!${qa}.service.listeners.has(listener))`);assert.equal(evidence.released,true,'关闭笔记释放本轮图表订阅');
 evidence.passed=true;await writeFile('dist/graph-polish-host-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 if(initialized)await evaluate(`(async()=>{const q=${qa};if(!q)return;q.weekly?.close();document.querySelector('.contribution-graph-editor-modal')?.querySelector('.modal-close-button,.modal-header-button:has(.lucide-x)')?.click();if(q.timelineQuery)q.service.getActivityTimelineDay=q.timelineQuery;if(q.dark!==undefined){document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);}q.leaf?.detach();if(q.file&&app.vault.getAbstractFileByPath(q.file.path))await app.vault.delete(q.file);if(q.oldLeaf?.view?.containerEl?.isConnected)app.workspace.setActiveLeaf(q.oldLeaf,{focus:false});for(const [name,value]of [['--font-text',q.fontText],['--font-interface',q.fontInterface]]){if(value)document.body.style.setProperty(name,value);else document.body.style.removeProperty(name);}delete window.__graphPolishQA;return true})()`).catch(error=>console.error('隔离验收清理失败',error));
 await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});
 await call('Runtime.evaluate',{expression:'delete window.__graphPolishPromise',returnByValue:true}).catch(()=>{});socket.close();
}
