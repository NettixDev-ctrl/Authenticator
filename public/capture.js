const canvas=document.getElementById('screen'),ctx=canvas.getContext('2d',{willReadFrequently:true}),area=document.getElementById('area'),hint=document.getElementById('hint');let ready=false,start=null,box=null,decoding=false;
capture.onImage(source=>{const image=new Image();image.onload=()=>{canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);ready=true;};image.src=source;});
function point(e){return {x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))};}
function draw(e){const p=point(e);box={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)};area.hidden=false;document.getElementById('shade').hidden=true;Object.assign(area.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});}
canvas.onpointerdown=e=>{if(!ready||decoding||e.button!==0)return;start=point(e);canvas.setPointerCapture(e.pointerId);draw(e);};
canvas.onpointermove=e=>{if(start)draw(e);};
canvas.onpointerup=async e=>{if(!start)return;draw(e);start=null;if(box.w<12||box.h<12){hint.textContent='Выделите область побольше · Esc — отмена';return;}decoding=true;try{
 const x=Math.floor(box.x*canvas.width/innerWidth),y=Math.floor(box.y*canvas.height/innerHeight),w=Math.min(canvas.width-x,Math.ceil(box.w*canvas.width/innerWidth)),h=Math.min(canvas.height-y,Math.ceil(box.h*canvas.height/innerHeight));
 const image=ctx.getImageData(x,y,w,h);let value;
 if(typeof jsQR==='function')value=jsQR(image.data,w,h,{inversionAttempts:'attemptBoth'})?.data;
 else if('BarcodeDetector' in window){const crop=document.createElement('canvas');crop.width=w;crop.height=h;crop.getContext('2d').putImageData(image,0,0);value=(await new BarcodeDetector({formats:['qr_code']}).detect(crop))[0]?.rawValue;}
 else throw Error('QR-декодер не установлен. Выполните npm install.');
 if(!value)throw Error('QR не найден. Выделите весь код с белой рамкой.');
 if(!value.startsWith('otpauth://totp/')&&!value.startsWith('otpauth-migration://'))throw Error('Это не QR-код двухэтапной аутентификации.');
 capture.finish(value);
 }catch(error){hint.textContent=error.message+' · Повторите выделение или нажмите Esc';}finally{decoding=false;}};
canvas.onpointercancel=()=>{start=null;};document.addEventListener('keydown',e=>{if(e.key==='Escape')capture.finish();});document.getElementById('cancel').onclick=()=>capture.finish();
