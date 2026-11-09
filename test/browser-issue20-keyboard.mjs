// Fresh isolated fixture on localhost:19983. Synthetic identity only.
const assert=(await import('node:assert/strict')).default;
const fs=await import('node:fs/promises');
const t=await taskSpace('wuwa20 desktop keyboard smoke 19983');
const p=t.page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('http://localhost:19983/s/123');
await p.waitForSelector('#login',{state:'visible'});
await p.keyboard.press('Tab');
const focus=await p.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,id:e.id,text:e.textContent.trim(),focusVisible:e.matches(':focus-visible'),outline:s.outlineStyle,width:innerWidth,scroll:document.documentElement.scrollWidth};});
assert.equal(focus.id,'login');assert.equal(focus.focusVisible,true);assert.notEqual(focus.outline,'none');assert.equal(focus.width,1365);assert.equal(focus.scroll,1365);
await p.keyboard.press('Enter');await p.waitForSelector('#register',{state:'visible'});
await p.focus('#register');await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#self').textContent.includes('序號 1'));
const registration=await p.evaluate(()=>document.querySelector('#self').textContent.trim());
await p.screenshot({path:'/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue20-qa/desktop-keyboard.png'});
const result={synthetic:true,focus,registration};await fs.writeFile('/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue20-qa/desktop-receipt.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await t.finish({keep:[]});
