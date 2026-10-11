const {spawn}=require('node:child_process');
let executable;try{executable=require('electron')}catch{executable='electron'}
const child=spawn(executable,[__dirname,...process.argv.slice(2)],{stdio:'inherit'});
child.on('error',()=>{console.error('Установите зависимости: npm install (или системный Electron).');process.exit(1)});
child.on('exit',code=>process.exit(code??1));
