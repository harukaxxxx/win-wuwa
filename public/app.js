const $=id=>document.getElementById(id); let csrf='',version=0;
async function load(){
 try { const session=await fetch('/api/session'); if(session.status===401)return; if(!session.ok)throw Error(); const data=await session.json(); csrf=data.csrf; $('signed-out').hidden=true; $('workspace').hidden=false;
 if(!data.approved){$('permission').textContent='此身分未獲核准；登入不代表取得主播資格。';return;}
 $('permission').textContent='本人隔離環境'; const res=await fetch('/api/environment'); if(!res.ok)throw Error(); const row=await res.json(); version=row.version; $('value').value=row.value; $('editor').hidden=false;
 }catch{$('message').textContent='讀取失敗；請稍後重試。';}
}
$('editor').addEventListener('submit',async e=>{e.preventDefault(); try{const res=await fetch('/api/environment',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({value:$('value').value,version})}); if(res.status===409){$('message').textContent='資料已變更；請重新載入後確認。';return;} if(!res.ok)throw Error(); const data=await res.json(); version=data.version; $('message').textContent='已儲存。';}catch{$('message').textContent='儲存結果未知；重新載入確認後再試。';}});
$('logout').addEventListener('click',async()=>{try{const res=await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});if(!res.ok)throw Error();location.reload();}catch{$('message').textContent='登出失敗，請重試。';}});
load();
