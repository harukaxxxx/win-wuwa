// Runs against two isolated, synthetic OAuth fixtures; never contacts Discord.
const assert=(await import('node:assert/strict')).default;
const fs=await import('node:fs/promises');
const root='/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa16-name';
const task=await taskSpace('wuwa16 approved name snapshots');console.log('space',task.spaceId);
const p=task.page('p1');await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const receipts=[];
for(const [port,expected] of [[19831,'群暱稱 300'],[19832,'f***0']]){
 const base=`http://localhost:${port}`;
 await p.goto(base+'/s/123');await p.waitForSelector('#login',{state:'visible'});await p.click('#login');await p.waitForSelector('#register',{state:'visible'});await p.click('#register');await p.waitForFunction(()=>document.querySelector('#self').textContent.includes('序號 1'));
 await p.click('loc=role:button[name="更新本人機率"]');await p.waitForFunction(()=>document.body.textContent.includes('候選資料更新時間')&&document.body.textContent.includes('100.00%'));
 const chance=await p.evaluate(()=>[...document.querySelectorAll('p')].find(x=>x.textContent.includes('候選資料更新時間')).textContent);
 const metrics=await p.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));assert.deepEqual(metrics,{innerWidth:390,clientWidth:390,scrollWidth:390});
 await p.click('#logout-viewer');await p.waitForSelector('#login',{state:'visible'});assert.equal((await p.fetch('/__fixture/status',{method:'POST',body:'owner'})).status,200);
 await p.goto(base+'/');await p.click('text=以 Discord 登入');await p.waitForSelector('loc=role:button[name="抽選"]',{state:'visible'});await p.click('loc=role:button[name="抽選"]');await p.waitForFunction(()=>document.querySelector('#draw-result').textContent.includes('中獎'));
 await p.click('text=本人場次名單與聯絡');await p.click('loc=role:button[name="讀取本人場次"]');await p.waitForSelector('loc=role:button[name*="aaaaaaaa"]',{state:'visible'});await p.click('loc=role:button[name*="aaaaaaaa"]');await p.waitForSelector('loc=role:button[name="複製username"]',{state:'visible'});
 const contact=await p.evaluate(()=>({link:[...document.querySelectorAll('a')].find(x=>x.textContent==='開啟 Discord 聯絡')?.href,fields:[...document.querySelectorAll('input')].filter(x=>x.readOnly).map(x=>x.value)}));assert.equal(contact.link,'https://discord.com/users/300');assert.ok(contact.fields.includes('fixture_300'));assert.ok(contact.fields.includes('300'));
 await p.evaluate(()=>document.querySelector('input[aria-label="username"]').scrollIntoView({block:'center'}));await p.screenshot({path:`${root}/${port}-private.png`});await p.click('#logout');await p.waitForSelector('text=以 Discord 登入',{state:'visible'});await p.goto(base+'/s/123');await p.waitForFunction(name=>document.querySelector('[aria-label="本場中獎結果"]').textContent.includes(name),expected);
 const raw=(await p.fetch('/api/viewer/123/results')).body;assert.deepEqual(JSON.parse(raw),{winners:[{display_name:expected}],next_cursor:null});assert.ok(!raw.includes('fixture_300'));const visible=await p.evaluate(()=>document.body.innerText);assert.ok(!visible.includes('fixture_300'));
 await p.evaluate(()=>document.querySelector('[aria-label="本場中獎結果"]').scrollIntoView({block:'center'}));await p.screenshot({path:`${root}/${port}-public.png`});receipts.push({port,expected,metrics,chance,contact,public:JSON.parse(raw)});
}
const receipt={synthetic:true,provider:'synthetic OAuth; not real Discord',receipts};await fs.writeFile(root+'/browser-name-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));await task.finish({keep:[]});
