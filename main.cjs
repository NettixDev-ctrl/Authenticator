const {app,BrowserWindow,ipcMain,safeStorage,desktopCapturer,session,clipboard,dialog,screen,nativeImage}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
let win,accounts=[],otp,file,backup;let queue=Promise.resolve();
function publicAccount(a){const {secret,...rest}=a;return rest}
async function save(next){const data=JSON.stringify(next,null,2);await fs.writeFile(file+'.tmp',data,{mode:0o600});await fs.rename(file+'.tmp',file);accounts=next;}
function mutate(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
app.whenReady().then(async()=>{otp=await import('./otp.js');backup=await import('./backup.js');file=path.join(app.getPath('userData'),'accounts.json');
try{accounts=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(accounts))throw Error('Неверный формат хранилища');}
catch(e){if(e.code!=='ENOENT'){dialog.showErrorBox('Не удалось открыть аккаунты','Файл accounts.json повреждён или недоступен. Исходный файл не изменён.');app.quit();return;}
let legacy;
try{legacy=await fs.readFile(path.join(app.getPath('userData'),'accounts.enc'));}
catch(error){if(error.code!=='ENOENT'){dialog.showErrorBox('Не удалось прочитать прежнее хранилище','Файл accounts.enc недоступен. Исходный файл не изменён.');app.quit();return;}}
if(legacy){let migrated;try{migrated=JSON.parse(safeStorage.decryptString(legacy));if(!Array.isArray(migrated))throw Error('Неверный формат');}
catch{await dialog.showMessageBox({type:'info',title:'Прежние аккаунты',message:'Прежние зашифрованные аккаунты не удалось прочитать. Можно добавлять новые без системного хранилища. Файл accounts.enc сохранён для восстановления.'});}
if(migrated){try{await save(migrated);}catch{dialog.showErrorBox('Ошибка сохранения','Не удалось перенести аккаунты в accounts.json. Исходный accounts.enc сохранён.');app.quit();return;}}}}

if(accounts.some(a=>'remote' in a)){await save(accounts.map(({remote,...account})=>account));}
session.defaultSession.setPermissionRequestHandler((wc,permission,callback)=>callback(wc===win?.webContents&&permission==='display-capture'));
session.defaultSession.setDisplayMediaRequestHandler(async(req,callback)=>{try{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});callback({video:sources[0]})}catch{callback({})}},{useSystemPicker:true});
win=new BrowserWindow({width:490,height:780,frame:false,icon:path.join(__dirname,'public/assets/logo.png'),minWidth:390,minHeight:560,backgroundColor:'#f6f8fc',autoHideMenuBar:true,title:'Authenticator',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());for(const event of ['maximize','unmaximize'])win.on(event,()=>win.webContents.send('window-state-changed',win.isMaximized()));await win.loadFile('public/index.html');});
ipcMain.handle('list',()=>accounts.map(publicAccount));
function validateQrValue(value){const text=String(value||'').trim();return text.startsWith('otpauth-migration://')?otp.parseMigration(text):otp.parseSecret(text);}
ipcMain.handle('add',(_,data)=>mutate(async()=>{
 const input=String(data.input||'');
 if(input.trim().startsWith('otpauth-migration://')){
  const migration=otp.parseMigration(input);const next=[...accounts];let added=0,skipped=0;
  for(const entry of migration.accounts){
   if(next.some(a=>a.secret===entry.secret&&a.algorithm===entry.algorithm&&a.digits===entry.digits&&a.period===entry.period)){skipped++;continue;}
   next.push({...entry,id:randomUUID()});added++;
  }
  if(added)await save(next);
  return {migration:true,added,skipped,total:migration.accounts.length,batchSize:migration.batchSize,batchIndex:migration.batchIndex};
 }
 const parsed=otp.parseSecret(input,data.encoding);const name=String(data.name||parsed.name||'').trim().slice(0,100);if(!name)throw Error('Введите название');if(accounts.some(a=>a.secret===parsed.secret&&a.algorithm===parsed.algorithm&&a.period===parsed.period&&a.digits===parsed.digits))throw Error('Этот ключ уже добавлен');const account={...parsed,name,id:randomUUID()};await save([...accounts,account]);return publicAccount(account)}));
ipcMain.handle('rename',(_,id,name)=>mutate(async()=>{name=String(name).trim().slice(0,100);if(!name)throw Error('Введите название');await save(accounts.map(a=>a.id===id?{...a,name}:a));}));
ipcMain.handle('delete',(_,id)=>mutate(()=>save(accounts.filter(a=>a.id!==id))));
ipcMain.handle('codes',()=>{const now=Date.now();return accounts.map(a=>{const remaining=a.period-Math.floor(now/1000)%a.period;try{return {id:a.id,code:otp.totp(a,now),remaining,period:a.period};}catch{return {id:a.id,error:'Некорректный ключ',remaining,period:a.period};}});});
ipcMain.handle('copy',(_,code)=>{if(/^\d{6,8}$/.test(code))clipboard.writeText(code)});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});

ipcMain.handle('window-control',(_,action)=>{if(action==='minimize')win.minimize();else if(action==='maximize'){if(win.isMaximized())win.unmaximize();else win.maximize();}else if(action==='close')win.close();});
ipcMain.handle('window-state',()=>win.isMaximized());
ipcMain.handle('export-backup',()=>mutate(async()=>{
 const result=await dialog.showSaveDialog(win,{title:'Экспорт аккаунтов',defaultPath:'authenticator-backup.json',filters:[{name:'Резервная копия',extensions:['json']}]});
 if(result.canceled)return {canceled:true};
 await fs.writeFile(result.filePath,backup.exportBackup(accounts),{mode:0o600});await fs.chmod(result.filePath,0o600);
 return {count:accounts.length};
}));
ipcMain.handle('import-backup',()=>mutate(async()=>{
 const result=await dialog.showOpenDialog(win,{title:'Импорт аккаунтов',properties:['openFile'],filters:[{name:'Резервная копия',extensions:['json']}]});
 if(result.canceled)return {canceled:true};
 const handle=await fs.open(result.filePaths[0],'r');let contents;
 try{if((await handle.stat()).size>5*1024*1024)throw Error('Файл превышает 5 МБ');contents=await handle.readFile('utf8');}finally{await handle.close();}
 const merged=backup.mergeBackup(contents,accounts);if(merged.added)await save(merged.accounts);
 return {added:merged.added,skipped:merged.skipped};
}));

let captureWindow=null;
ipcMain.handle('select-qr',async(event,image)=>{
 if(event.sender!==win.webContents||captureWindow)throw Error('Захват уже открыт');
 if(typeof image!=='string'||!image.startsWith('data:image/png;base64,')||image.length>100*1024*1024)throw Error('Некорректный снимок');
 const size=nativeImage.createFromDataURL(image).getSize();if(!size.width||!size.height)throw Error('Пустой снимок');
 const nearest=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
 const matches=screen.getAllDisplays().filter(d=>Math.abs(d.size.width*d.scaleFactor-size.width)<2&&Math.abs(d.size.height*d.scaleFactor-size.height)<2);
 const display=matches.find(d=>d.id===nearest.id)||matches[0]||nearest;
 return new Promise(resolve=>{
 const overlay=new BrowserWindow({...display.bounds,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,show:false,backgroundColor:'#000000',webPreferences:{preload:path.join(__dirname,'capture-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 captureWindow=overlay;let done=false;
 function finish(result){if(done)return;done=true;ipcMain.removeListener('qr-selected',selected);captureWindow=null;if(!overlay.isDestroyed())overlay.close();if(!win.isDestroyed()){if(!win.isVisible())win.show();win.focus();}resolve(result);}
 function selected(sender,result){if(sender.sender!==overlay.webContents)return;if(result?.value){try{validateQrValue(result.value);}catch(error){finish({error:error.message});return;}finish({value:result.value});}else finish({canceled:true});}
 ipcMain.on('qr-selected',selected);overlay.on('closed',()=>finish({canceled:true}));
 overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));overlay.webContents.on('will-navigate',e=>e.preventDefault());
 overlay.webContents.once('did-finish-load',()=>{overlay.webContents.send('capture-image',image);overlay.show();overlay.focus();});
 overlay.loadFile('public/capture.html').catch(error=>finish({error:'Не удалось открыть выделение: '+error.message}));
 });
});

const {execFile}=require('node:child_process');const {promisify}=require('node:util');const runFile=promisify(execFile);const os=require('node:os');
const kdeCapture=process.platform==='linux'&&!!process.env.WAYLAND_DISPLAY&&/kde/i.test(process.env.XDG_CURRENT_DESKTOP||'');
let nativeCaptureBusy=false;
ipcMain.handle('capture-mode',()=>kdeCapture?'spectacle':'electron');
ipcMain.handle('capture-native',async event=>{
 if(event.sender!==win.webContents||!kdeCapture)throw Error('Системный захват недоступен');
 if(nativeCaptureBusy)throw Error('Выделение уже открыто');nativeCaptureBusy=true;
 let directory;
 try{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'authenticator-qr-'));const target=path.join(directory,'region.png');
 try{await runFile('spectacle',['--background','--region','--nonotify','--release-capture','--output',target],{timeout:120000,maxBuffer:1024*1024});}
 catch(error){if(error.code==='ENOENT')throw Error('Для выделения QR в KDE нужен Spectacle. Установите пакет spectacle.');if(error.killed)throw Error('Время выделения истекло. Попробуйте ещё раз.');try{await fs.access(target);}catch{if(error.code===1)return {canceled:true};throw Error('Не удалось открыть выделение Spectacle. '+String(error.stderr||error.message).slice(0,250));}}
 let bytes;try{bytes=await fs.readFile(target);}catch(error){if(error.code==='ENOENT')return {canceled:true};throw error;}
 const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('Пустой снимок QR');
 const {width,height}=image.getSize();const bitmap=image.toBitmap();const rgba=new Uint8ClampedArray(bitmap.length);
 for(let i=0;i<bitmap.length;i+=4){rgba[i]=bitmap[i+2];rgba[i+1]=bitmap[i+1];rgba[i+2]=bitmap[i];rgba[i+3]=bitmap[i+3];}
 const jsQR=require('jsqr');const decoded=jsQR(rgba,width,height,{inversionAttempts:'attemptBoth'});
 if(!decoded)throw Error('QR не найден. Выделите весь код вместе с белой рамкой.');
 if(!decoded.data.startsWith('otpauth://totp/')&&!decoded.data.startsWith('otpauth-migration://'))throw Error('Это не QR-код двухэтапной аутентификации');
 validateQrValue(decoded.data);return {value:decoded.data};
 }finally{nativeCaptureBusy=false;if(directory)await fs.rm(directory,{recursive:true,force:true});}
});
