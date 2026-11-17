import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

// 样例只替换隔离库的只读查询，不导入正式统计。
const endpoint=process.env.OBSIDIAN_TEST_CDP||"http://127.0.0.1:9231";
const target=(await(await fetch(endpoint+"/json/list")).json()).find(t=>t.type==="page"&&t.url.startsWith("app://"));
assert.ok(target);
const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
const runtimeErrors=[];
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
socket.onmessage=event=>{const response=JSON.parse(event.data);if(response.method==='Runtime.exceptionThrown')runtimeErrors.push(response.params.exceptionDetails.text);if(response.method==='Runtime.consoleAPICalled'&&response.params.type==='error')runtimeErrors.push(response.params.args.map(arg=>arg.value||arg.description).join(' '));const task=pending.get(response.id);if(!task)return;pending.delete(response.id);response.error?task.reject(response.error):task.resolve(response.result);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(expression){
 const result=await call("Runtime.evaluate",{expression:"window.__timelineEvalPromise=Promise.resolve(eval("+JSON.stringify(expression)+"))",returnByValue:true,awaitPromise:true,userGesture:true});
 assert.ok(!result.exceptionDetails,result.exceptionDetails?.exception?.description);
 return result.result.value;
}
async function click(selector,modifiers=0){
 const point=await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 assert.ok(point,selector);
 await call("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1,modifiers});
 await call("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1,modifiers});await wait(90);
}
async function choose(selector,value){
 const menu=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),details=e?.closest('.cg-activity-timeline-display');if(!details||details.open)return null;return ${JSON.stringify(selector)}.split(' [data-timeline-control=')[0]+' details > summary'})()`);
 if(menu)await click(menu);
 await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await wait(100);
 if(menu)await click(menu);
}
async function screenshot(name){
 await wait(300);await writeFile("dist/"+name,Buffer.from((await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
}
async function waitFor(expression,message){
 const deadline=Date.now()+4000;
 while(Date.now()<deadline){if(await evaluate(expression))return;await wait(100);}
 assert.fail(message);
}
function fixture(query){
 const date=query.date,today=new Date().toLocaleDateString("sv-SE");
 const samples=[
  ["s1","临床医学/妇产科学/女性生殖系统.md",490,545,"one"],
  ["s3","临床医学/妇产科学/分支/女性生殖系统.md",510,530,"two"],
  ["s2","临床医学/妇产科学/女性生殖系统.md",555,590,"one"],
  ["y1","activity://yolo-chat",590,605,"one"],
  ["m1","临床医学/内科学/心力衰竭.md",610,665,"one"],
  ["m2","临床医学/内科学/心力衰竭.md",675,715,"one"],
  ["long","临床医学/内科学/用于检验长中文标题在色块内省略且不越界的学习笔记.md",665,715,"one"],
  ["tiny","临床医学/内科学/一秒活动.md",716,716+1/60,"one"],
 ];
 const folders=query.folders||[];
 const raw=samples.filter(([,path])=>!folders.length||path.startsWith(folders[0]+"/"));
 const blocks=(date==="2026-11-16"?raw:date==="2026-11-15"?raw.slice(0,2):[]).map(([id,path,startMinute,endMinute,sourceId])=>{
  const activity=path.startsWith("activity:"),name=activity?"YOLO 对话活动":path.includes("妇产科学")?"妇产科学":"内科学";
  const suffix=query.depth===2&&!activity?"/二级":"";
  const base=Date.parse(date+"T00:00:00+08:00");
  return {id,segmentIds:[id],sourceId,continuityId:id,path,start:base+startMinute*60000,end:base+endMinute*60000,seconds:(endMinute-startMinute)*60,startMinute,endMinute,offsetMinutes:480,groupId:(activity?"activity:yolo":"folder:"+name)+suffix,groupName:name+suffix,activity};
 });
 const locatedSeconds=blocks.reduce((sum,block)=>sum+block.seconds,0);
 const summary=date==="2026-11-14"?5400:date==="2026-11-15"?3600:0;
 return {date,today,totalSeconds:locatedSeconds+summary,locatedSeconds,...(date==="2026-11-15"?{unlocatedSeconds:summary}:{}),
  precision:date==="2026-11-14"?"SUMMARY_ONLY":date==="2026-11-15"?"MIXED":blocks.length?"DETAILED":"EMPTY",
  blocks,warnings:date==="2026-11-14"?["历史仅有小时汇总，无法还原片段"]:[],recordedDates:["2026-11-14","2026-11-15","2026-11-16"]};
}

const plugin="app.plugins.plugins['contribution-graph-local']",qa="window.__activityTimelineQA";
const first="#timeline-acceptance-a ",second="#timeline-acceptance-b ";
const evidence={};let initialized=false;
try{
 assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith("/dist/time-acceptance/vault"));
 await call('Runtime.enable');runtimeErrors.length=0;
 await call("Emulation.setDeviceMetricsOverride",{width:1200,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`(async()=>{const p=${plugin},s=p.activityService;app.setting.close();for(const m of p.weeklyReviewModals.values())m.close();const path='临床医学/妇产科学/女性生殖系统.md';if(!app.vault.getAbstractFileByPath('临床医学'))await app.vault.createFolder('临床医学');if(!app.vault.getAbstractFileByPath('临床医学/妇产科学'))await app.vault.createFolder('临床医学/妇产科学');const existed=!!app.vault.getAbstractFileByPath(path);if(!existed)await app.vault.create(path,'# 隔离时间轴样例');window.__activityTimelineQA={query:s.getActivityTimelineDay,hourly:s.getHourlyTimeStats,open:app.workspace.openLinkText,settings:JSON.stringify(s.getSettings()),font:document.body.style.getPropertyValue('--font-text'),queries:0,opens:[],existed,path,listeners:s.listeners.size,dark:document.body.classList.contains('theme-dark'),light:document.body.classList.contains('theme-light')};document.body.style.setProperty('--font-text','霞鹜文楷等宽');s.getActivityTimelineDay=function(query){window.__activityTimelineQA.queries++;return (${fixture.toString()})(query)};s.getHourlyTimeStats=function(query){if(query.fromDate==='2026-11-14')return[{date:'2026-11-14',hour:9,seconds:5400,documents:[{path,seconds:5400}],trackingState:'PARTIAL',future:false}];return window.__activityTimelineQA.hourly.call(this,query)};app.workspace.openLinkText=async(path,source,newLeaf)=>{window.__activityTimelineQA.opens.push({path,newLeaf});};const stage=document.body.createDiv({attr:{id:'timeline-acceptance-stage'}});stage.style.cssText='position:fixed;inset:0;z-index:20;background:var(--background-primary);padding:24px;overflow:auto;';stage.createDiv({attr:{id:'timeline-acceptance-a'}});stage.createDiv({attr:{id:'timeline-acceptance-b'}});window.__activityTimelineQA.stage=stage;return true})()`);initialized=true;
 await evaluate(`(async()=>{const q=${qa};q.oldLeaf=app.workspace.activeLeaf;q.codePath="周回顾验收/时间轴功能验收-"+Date.now()+".md";if(!app.vault.getAbstractFileByPath("周回顾验收"))await app.vault.createFolder("周回顾验收");const file=await app.vault.create(q.codePath,${JSON.stringify(["```contributionGraph","title: 学习时间轴","graphType: timeline","dateRangeType: FIXED_DATE_RANGE","fromDate: 2026-11-14","toDate: 2026-11-16","dataSource:","  type: TIME_ACTIVITY","```"].join("\n"))});q.leaf=app.workspace.getLeaf("tab");await q.leaf.openFile(file,{state:{mode:"preview"}});await new Promise(resolve=>setTimeout(resolve,700));const graph=q.leaf.view.containerEl.querySelector(".cg-activity-timeline-graph");if(!graph)throw Error("代码块没有生成时间轴："+q.leaf.view.containerEl.textContent.slice(-600));document.getElementById("timeline-acceptance-a").appendChild(graph.parentElement);window.renderContributionGraph(document.getElementById("timeline-acceptance-b"),{title:"第二个时间轴",graphType:"timeline",data:[],fromDate:"2026-11-14",toDate:"2026-11-16",activityFolders:[]});return true})()`);await wait(600);
 assert.equal(await evaluate("document.querySelectorAll('#timeline-acceptance-stage .cg-activity-timeline').length"),2);

 const surface=await evaluate(`(()=>{const graph=document.querySelector('${first}.cg-activity-timeline-graph'),card=graph.querySelector(':scope > .main'),timeline=graph.querySelector('.cg-activity-timeline');return{count:graph.querySelectorAll('.main').length,contains:card?.contains(timeline),rounded:card?parseFloat(getComputedStyle(card).borderRadius)>0:false,shadow:card?getComputedStyle(card).boxShadow:'none',titles:graph.querySelectorAll('.cg-activity-timeline-header h3').length}})()`);
 assert.equal(surface.count,1,'嵌入时间轴使用一层共用热力图容器');assert.ok(surface.contains&&surface.rounded&&surface.shadow!=='none');assert.equal(surface.titles,1,'容器不重复生成标题');evidence.sharedSurface=surface;
 assert.ok(await evaluate(`document.querySelector('${first}.cg-activity-timeline-chart svg')&&document.querySelector('${second}.cg-activity-timeline-chart svg')`),"代码块和全局渲染均接通");
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="date"]').value`),"2026-11-16");
 assert.equal(await evaluate(`document.querySelector('${first}.cg-activity-timeline-display')?.open`),false,'低频显示操作默认收起');
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').getBoundingClientRect().height`),0,'片段选择不再常驻占行');
 await click(first+'[data-timeline-control="display"]');
 assert.ok(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').getBoundingClientRect().height>0`),'展开显示菜单后仍可定位片段');
 await evaluate(`document.querySelector('${first}[data-timeline-control="depth"]').focus()`);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 assert.equal(await evaluate(`document.querySelector('${first}.cg-activity-timeline-display').open`),false,'退出键关闭显示菜单');
 assert.equal(await evaluate(`document.activeElement.dataset.timelineControl`),'display','菜单关闭后保留焦点');
 await click(first+'[data-timeline-control="display"]');
 await click(first+'[data-timeline-control="fit"]');
 assert.equal(await evaluate(`document.querySelector('${first}.cg-activity-timeline-display').open`),false,'点击菜单外关闭显示菜单');
 evidence.compactToolbar=true;
 await evaluate(`document.querySelector('${second}.cg-activity-timeline').style.width='280px'`);
 await click(second+'[data-timeline-control="display"]');
 assert.ok(await evaluate(`(()=>{const r=document.querySelector('${second}.cg-activity-timeline').getBoundingClientRect(),p=document.querySelector('${second}.cg-activity-timeline-display-panel').getBoundingClientRect();return p.left>=r.left&&p.right<=r.right})()`),'宽屏中嵌入窄图表的菜单也不溢出');
 await click(second+'[data-timeline-control="display"]');
 await evaluate(`document.querySelector('${second}.cg-activity-timeline').style.removeProperty('width')`);
 await evaluate(`(()=>{const view=${qa}.leaf.view;view.editor.setSelection({line:0,ch:0});app.commands.commands['contribution-graph-local:create-graph'].editorCallback(view.editor,view);return true})()`);await wait(250);
 await choose('.contribution-graph-editor-modal select[name="graphType"]',"timeline");await wait(350);
 assert.ok(await evaluate("Array.from(document.querySelectorAll('.contribution-graph-editor-modal input[type=number]')).some(e=>e.value==='30')"),"新建时间轴默认三十天");
 await waitFor("!!document.querySelector('.contribution-graph-editor-modal .cg-activity-timeline')","表单预览接通时间轴");
 await click('.contribution-graph-editor-modal :is(.modal-close-button,.modal-header-button:has(.lucide-x))');
 await evaluate(`(()=>{const q=${qa};q.realDate=Date;for(const id of ['timeline-rolling-today','timeline-rolling-history']){const el=q.stage.createDiv({attr:{id}});window.renderContributionGraph(el,{title:'跨日验收',graphType:'timeline',data:[],days:30});}return true})()`);
 await choose('#timeline-rolling-history [data-timeline-control="date"]',"2026-11-16");
 const rolledToday=await evaluate("new Date(Date.now()+86400000).toLocaleDateString('sv-SE')");
 await evaluate(`(()=>{const Original=${qa}.realDate;window.Date=class extends Original{constructor(...args){super(...(args.length?args:[Original.now()+86400000]));}static now(){return Original.now()+86400000;}};for(const listener of ${plugin}.activityService.listeners)listener({type:'TEMPORAL'});document.getElementById('timeline-rolling-today').scrollIntoView({block:'start'});return true})()`);await wait(300);
 assert.equal(await evaluate("document.querySelector('#timeline-rolling-today [data-timeline-control=date]').value"),rolledToday,"跟随今天的滚动范围跨午夜推进");
 await evaluate("document.getElementById('timeline-rolling-history').scrollIntoView({block:'start'})");await wait(250);
 assert.equal(await evaluate("document.querySelector('#timeline-rolling-history [data-timeline-control=date]').value"),"2026-11-16","浏览历史跨午夜不跳回今天");
 await evaluate(`(()=>{window.Date=${qa}.realDate;document.getElementById('timeline-rolling-today').remove();document.getElementById('timeline-rolling-history').remove();${qa}.stage.scrollTop=0;for(const listener of ${plugin}.activityService.listeners)listener({type:'TEMPORAL'});return true})()`);await wait(300);
 const before=await evaluate(`${qa}.queries`);
 await click(first+'[data-timeline-control="zoom-in"]');
 await click(first+'[data-timeline-control="full-day"]');
 await click(first+'[data-timeline-control="fit"]');
 const ticks=()=>evaluate(`Array.from(document.querySelectorAll('${first}.cg-activity-timeline-chart svg text')).map(e=>e.textContent).filter(s=>/^\\d{2}:\\d{2}$/.test(s))`);
 const originalTicks=await ticks();
 const slider=await evaluate(`(()=>{const h=document.querySelector('${first}.cg-activity-timeline-chart'),bottom=h.getBoundingClientRect().bottom;const p=[...h.querySelectorAll('svg path')].find(p=>{const r=p.getBoundingClientRect();return r.bottom>bottom-42&&r.height>=15&&r.height<=25&&r.width>20&&r.width<h.clientWidth/2});if(!p)return null;const r=p.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 assert.ok(slider,"底部时间导航条");
 await call("Input.dispatchMouseEvent",{type:"mousePressed",...slider,button:"left",clickCount:1});
 await call("Input.dispatchMouseEvent",{type:"mouseMoved",x:slider.x+70,y:slider.y,button:"left",buttons:1});
 await call("Input.dispatchMouseEvent",{type:"mouseReleased",x:slider.x+70,y:slider.y,button:"left",clickCount:1});await wait(300);
 assert.notDeepEqual(await ticks(),originalTicks,"真实拖动平移时间窗口");
 await click(first+'[data-timeline-control="fit"]');
 assert.equal(await evaluate(`${qa}.queries`),before,"缩放不重读统计");
 const point=await evaluate(`(()=>{const host=document.querySelector('${first}.cg-activity-timeline-chart');const p=[...host.querySelectorAll('svg path')].find(p=>{const r=p.getBoundingClientRect();return r.width>25&&r.height>=10&&r.height<=28&&p.getAttribute('fill')&&p.getAttribute('fill')!=='none'});if(!p)return null;const r=p.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 assert.ok(point,"真实区间图形");
 await call("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1});await call("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1});await wait(100);
 assert.ok(await evaluate(`!!document.querySelector('${first}.cg-activity-timeline-detail-card')`),"图形点击联动明细");
 await choose(first+'[data-timeline-control="segment"]',"s1");
 assert.ok(await evaluate(`document.querySelector('${first}.cg-activity-timeline-detail-time').textContent.includes('08:10:00–09:05:00')`),"明细用记录时钟面时间");
 assert.equal(await evaluate(`document.querySelectorAll('${first}[data-timeline-segment]').length`),1,"同名异路径不混入同篇列表");
 await click(first+'[data-timeline-segment="s2"]');
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').value`),"s2");
 await click(first+'[data-timeline-action="next"]');
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').value`),"y1");
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-action="open"]')!==null`),false,"YOLO不生成笔记打开入口");
 await click(first+'[data-timeline-action="previous"]');
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').value`),"s2");
 assert.equal(await evaluate("document.activeElement.dataset.timelineAction"),"previous","明细切换保留焦点");
 await click(first+'[data-timeline-action="open"]',2);
 assert.ok(await evaluate(`${qa}.opens.some(o=>o.path===${qa}.path&&o.newLeaf)`),"打开笔记支持修饰键");
 await choose(first+'[data-timeline-control="depth"]',"2");
 assert.ok(await evaluate(`[...document.querySelectorAll('${first}[data-timeline-group]')].some(e=>e.textContent.includes('二级'))`));
 await choose(first+'[data-timeline-control="depth"]',"1");
 await screenshot("activity-timeline-overview-1200.png");
 await choose(first+'[data-timeline-control="date"]',"2026-11-14");
 assert.equal(await evaluate(`document.querySelector('${first}.cg-activity-timeline-chart').hidden`),true,"旧历史没有伪造色块");
 assert.equal(await evaluate(`document.querySelector('${first}[data-timeline-control="segment"]').disabled`),true);
 assert.equal(await evaluate(`document.querySelector('${second}[data-timeline-control="date"]').value`),"2026-11-16","实例日期互不影响");
 await click(first+'[data-timeline-action="hourly"]');
 assert.equal(await evaluate("document.querySelectorAll('.cg-activity-timeline-modal').length"),1);
 assert.ok(await evaluate("!!document.querySelector('.cg-activity-timeline-modal .hourly-profile')"),"旧历史复用既有小时图");
 await click('.cg-activity-timeline-modal .cg-activity-timeline-summary > button');
 await click('.cg-activity-timeline-modal :is(.modal-close-button,.modal-header-button:has(.lucide-x))');
 await choose(first+'[data-timeline-control="date"]',"2026-11-16");
 await choose(first+'[data-timeline-control="depth"]',"2");
 await click(first+'[data-timeline-control="zoom-in"]');
 const enlargedTicks=await ticks();
 await click(first+'[data-timeline-control="expand"]');
 assert.equal(await evaluate("document.querySelectorAll('.cg-activity-timeline-modal').length"),1);
 assert.equal(await evaluate("document.querySelector('.cg-activity-timeline-modal [data-timeline-control=depth]').value"),"2","放大保留分组");
 assert.equal(await evaluate("document.querySelectorAll('.cg-activity-timeline-modal .cg-activity-timeline-surface').length"),0,'放大弹窗已有外框，不重复套卡片');
 assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.cg-activity-timeline-modal .cg-activity-timeline-chart svg text')).map(e=>e.textContent).filter(s=>/^\\d{2}:\\d{2}$/.test(s))"),enlargedTicks,"放大保留时间窗口");
 await click('.cg-activity-timeline-modal :is(.modal-close-button,.modal-header-button:has(.lucide-x))');
 await evaluate(`(()=>{app.commands.executeCommandById('contribution-graph-local:weekly-review');const m=${plugin}.weeklyReviewModals.values().next().value;m.dailyOpen=true;m.render();m.rootEl.querySelector('[data-review-day="2026-11-16"]').click();${qa}.weekly=m;${qa}.snapshot=m.snapshot;return true})()`);
 const weekly=qa+".weekly";
 await click('[data-review-action="open-activity-timeline"]');
 assert.ok(await evaluate(`${weekly}.rootEl.hidden&&${weekly}.activityView&&${weekly}.activityHost.querySelector('[data-review-action="back-from-activity-timeline"]')`));
 assert.equal(await evaluate(`${weekly}.activityView.getState().date`),"2026-11-16");
 assert.equal(await evaluate("document.querySelectorAll('.cg-weekly-activity-host .cg-activity-timeline-surface').length"),0,'周回顾内时间轴沿用弹窗背景，不重复套外框');
 assert.equal(await evaluate("document.querySelectorAll('.modal-container').length"),1,"周回顾内切换不叠容器");
 for(const [width,height,dark] of [[1200,900,true],[720,900,false],[320,780,false]]){
  await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark})`);await wait(400);
  const layout=await evaluate(`(()=>{const el=${weekly}.activityView.el;return{overflow:el.scrollWidth>el.clientWidth+1,font:getComputedStyle(el).fontFamily,svg:el.querySelectorAll('.cg-activity-timeline-chart svg').length}})()`);
  assert.equal(layout.overflow,false,width+"px溢出");assert.ok(layout.font.includes("霞鹜文楷"));assert.equal(layout.svg,1);evidence["layout"+width]=layout;
  const geometry=await evaluate(`(()=>{const chart=${weekly}.activityView.chart.chart,data=chart.getModel().getSeriesByIndex(0).getData(),items=[];for(let i=0;i<data.count();i++){const el=data.getItemGraphicEl(i);if(!el)continue;const rect=el.type==='group'?el.childAt(0):el,shape=rect.shape;const expected=chart.convertToPixel({xAxisIndex:0},data.getRawDataItem(i).value[2])-chart.convertToPixel({xAxisIndex:0},data.getRawDataItem(i).value[1]);const text=el.type==='group'?el.childAt(1):null;items.push({id:data.getRawDataItem(i).blockId,width:shape.width,expected,hasText:!!text,textFits:!text||text.getBoundingRect().width<=shape.width-11,rounded:Array.isArray(shape.r),font:!text||text.style.fontFamily.includes('霞鹜文楷')});}return items})()`);
  assert.equal(geometry.length,8,'全部真实片段接入渲染');
  if(width>=720)assert.ok(geometry.find(item=>item.id==='long').hasText,'长中文标题实际进入色块绘制并检验省略边界');
  for(const item of geometry){assert.ok(Math.abs(item.width-item.expected)<.1,'片段宽度保持时间比例：'+JSON.stringify(item));assert.ok(item.textFits&&item.rounded&&item.font,'圆角、文字边界与文楷：'+JSON.stringify(item));}
  assert.ok(geometry.find(item=>item.id==='tiny').width<1,'一秒片段不强制画成两像素');evidence['geometry'+width]=geometry;
  await click('.cg-weekly-activity-host [data-timeline-control="display"]');
  const panel=await evaluate(`(()=>{const root=${weekly}.activityView.el,r=root.getBoundingClientRect(),p=root.querySelector('.cg-activity-timeline-display-panel').getBoundingClientRect();return{left:p.left>=r.left-1,right:p.right<=r.right+1,font:getComputedStyle(root.querySelector('select')).fontFamily}})()`);
  assert.ok(panel.left&&panel.right,width+'px显示菜单不超出时间轴');assert.ok(panel.font.includes('霞鹜文楷'));
  await screenshot('activity-timeline-menu-'+width+'.png');
  await click('.cg-weekly-activity-host [data-timeline-control="display"]');
  await screenshot("activity-timeline-"+width+".png");
 }
 await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
 await choose('.cg-weekly-activity-host [data-timeline-control="segment"]',"s1");
 await click('[data-review-action="back-from-activity-timeline"]');
 assert.ok(await evaluate(`!${weekly}.rootEl.hidden&&!${weekly}.activityHost&&${weekly}.snapshot===${qa}.snapshot&&document.activeElement.dataset.reviewAction==='open-activity-timeline'`));
 await evaluate(`(()=>{${weekly}.close();${qa}.beforeDispose=${plugin}.activityService.listeners.size;document.getElementById('timeline-acceptance-a').remove();document.getElementById('timeline-acceptance-b').remove();return true})()`);await wait(200);
 const disposal=await evaluate(`({before:${qa}.beforeDispose,after:${plugin}.activityService.listeners.size})`);
 assert.ok(disposal.after<=disposal.before-1,"全局 API 嵌入移除后释放订阅："+JSON.stringify(disposal));
 const beforeLeaf=await evaluate(`(()=>{${qa}.beforeLeaf=[...${plugin}.activityService.listeners];${qa}.leaf.detach();return ${qa}.beforeLeaf.length})()`);await wait(150);
 const releasedOnLeaf=await evaluate(`${qa}.beforeLeaf.filter(listener=>!${plugin}.activityService.listeners.has(listener)).length`);
 assert.ok(releasedOnLeaf>=1,"代码块在笔记卸载时释放订阅");evidence.disposal={...disposal,beforeLeaf,releasedOnLeaf};
 assert.ok(await evaluate(`JSON.stringify(${plugin}.activityService.getSettings())===${qa}.settings`),"交互不改采集设置");
 evidence.embedAndInteractions=true;evidence.oldHistoryAndWeeklyEntry=true;evidence.passed=true;
 assert.deepEqual(runtimeErrors,[],'时间轴交互未产生运行时错误');evidence.runtimeErrors=runtimeErrors;
 await writeFile("dist/activity-timeline-host-evidence.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 await call("Emulation.clearDeviceMetricsOverride").catch(()=>{});await call("Emulation.setEmulatedMedia",{features:[]}).catch(()=>{});
 if(initialized)await evaluate(`(async()=>{const p=${plugin},q=${qa};if(!q)return;document.querySelector('.contribution-graph-editor-modal')?.querySelector('.modal-close-button,.modal-header-button:has(.lucide-x)')?.click();if(q.realDate)window.Date=q.realDate;p.activityService.getActivityTimelineDay=q.query;p.activityService.getHourlyTimeStats=q.hourly;app.workspace.openLinkText=q.open;for(const m of p.weeklyReviewModals.values())m.close();for(const el of document.querySelectorAll('.cg-activity-timeline-modal'))el.querySelector('.modal-close-button,.modal-header-button')?.click();q.leaf?.detach();q.stage?.remove();if(q.oldLeaf)app.workspace.setActiveLeaf(q.oldLeaf,{focus:false});const codeFile=q.codePath&&app.vault.getAbstractFileByPath(q.codePath);if(codeFile)await app.vault.delete(codeFile);if(!q.existed){const f=app.vault.getAbstractFileByPath(q.path);if(f)await app.vault.delete(f);}document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');delete window.__activityTimelineQA;return true})()`).catch(error=>console.error("恢复失败",error));
 await call("Runtime.evaluate",{expression:"delete window.__timelineEvalPromise",returnByValue:true}).catch(()=>{});
 socket.close();
}
