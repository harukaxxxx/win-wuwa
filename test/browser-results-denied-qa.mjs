// Fresh isolated WUWA_DENY_CLIPBOARD_QA loopback fixture on 19798.
const assert=(await import('node:assert/strict')).default;
const fs=await import('node:fs/promises');
const task=await taskSpace('wuwa16 denied clipboard completed results');
console.log('space',task.spaceId);
const p=task.page('p1');
const base='http://localhost:19798';
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await p.goto(base+'/s/123');await p.waitForSelector('#login',{state:'visible'});
await p.click('#login');await p.waitForSelector('#register',{state:'visible'});await p.click('#register');await p.waitForFunction(()=>document.querySelector('#self').textContent.includes('序號'));
await p.click('loc=role:button[name="更新本人機率"]');await p.waitForFunction(()=>document.body.textContent.includes('候選資料更新時間')&&document.body.textContent.includes('非整場中獎保證'));
const chance=await p.evaluate(()=>[...document.querySelectorAll('p')].find(x=>x.textContent.includes('候選資料更新時間')).textContent);
await p.click('#logout-viewer');await p.waitForSelector('#login',{state:'visible'});assert.equal((await p.fetch('/__fixture/status',{method:'POST',body:'owner'})).status,200);
await p.goto(base+'/');await p.click('text=以 Discord 登入');await p.waitForSelector('loc=role:button[name="抽選"]',{state:'visible'});await p.click('loc=role:button[name="抽選"]');await p.waitForFunction(()=>document.querySelector('#draw-result').textContent.includes('中獎'));
const confirm=await p.click('loc=role:button[name="正常結束並結算"]');assert.ok(confirm.dialog);await p.acceptDialog();await p.waitForFunction(()=>[...document.querySelectorAll('p')].some(x=>x.textContent.includes('已讀回確認結算完成')));
await p.reload();await p.waitForFunction(()=>document.querySelector('#activity-state').textContent==='目前沒有未完成場次');
await p.click('text=本人場次名單與聯絡');await p.click('loc=role:button[name="讀取本人場次"]');await p.waitForSelector('loc=role:button[name*="aaaaaaaa"]',{state:'visible'});await p.click('loc=role:button[name*="aaaaaaaa"]');await p.waitForSelector('loc=role:button[name="複製username"]',{state:'visible'});
const results=[];
for(const [label,value] of [['username','fixture_300'],['Discord ID','300']]){
 await p.focus(`loc=role:button[name="複製${label}"]`);assert.equal(await p.evaluate(()=>document.activeElement.textContent),'複製'+label);await p.keyboard.press('Enter');
 await p.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(x=>x.textContent.includes('無法自動複製')));
 const data=await p.evaluate(label=>{const input=document.querySelector(`input[aria-label="${label}"]`);const status=[...document.querySelectorAll('[role=status]')].find(x=>x.textContent.includes('無法自動複製'));return {focus:document.activeElement===input,value:input.value,selection:input.value.slice(input.selectionStart,input.selectionEnd),readOnly:input.readOnly,notice:status.textContent};},label);
 assert.deepEqual(data,{focus:true,value,selection:value,readOnly:true,notice:'無法自動複製，請手動複製選取內容。'});assert.ok(!data.notice.includes('已複製'));results.push({label,...data});
}
const metrics=await p.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));assert.deepEqual(metrics,{innerWidth:390,clientWidth:390,scrollWidth:390});
await p.screenshot({path:'/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue16-final/denied-390.png'});
await p.click('#logout');await p.waitForSelector('text=以 Discord 登入',{state:'visible'});await p.goto(base+'/s/123');await p.waitForFunction(()=>document.querySelector('#state').textContent.includes('目前沒有進行中的場次'));
const publicBody=(await p.fetch('/api/viewer/123/results')).body;assert.deepEqual(JSON.parse(publicBody),{winners:[],next_cursor:null});assert.ok(!publicBody.includes('fixture_300'));assert.ok(!(await p.evaluate(()=>document.body.textContent)).includes('fixture_300'));
const receipt={synthetic:true,clipboard:'fixture Promise rejection NotAllowedError (not browser permission prompt)',settled:true,chance,metrics,results,publicNoActivity:true,publicResults:JSON.parse(publicBody)};
await fs.writeFile('/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue16-final/denied-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({result:'PASS',...receipt}));await task.finish({keep:[]});
