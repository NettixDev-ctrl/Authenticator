const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('capture',{onImage:callback=>ipcRenderer.once('capture-image',(_,image)=>callback(image)),finish:value=>ipcRenderer.send('qr-selected',value?{value}:{canceled:true})});
