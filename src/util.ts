import fs from "fs";

// standard file ops
export function util_readdir(path:fs.PathLike){
    return new Promise<string[]>(resolve=>{
        fs.readdir(path,(err,files)=>{
            if(err) resolve([]);
            else resolve(files);
        });
    });
}
export function util_readdirWithTypes(path:fs.PathLike,recursive=false){
    return new Promise<fs.Dirent[]>(resolve=>{
        fs.readdir(path,{withFileTypes:true,recursive},(err,files)=>{
            if(err) resolve([]);
            else resolve(files);
        });
    });
}
export function util_readText(path:fs.PathOrFileDescriptor){
    return new Promise<string>(resolve=>{
        fs.readFile(path,{encoding:"utf8"},(err,data)=>{
            if(err) console.log("Err: ",err);
            resolve(data);
        });
    });
}
export function util_readJSON<T>(path:fs.PathOrFileDescriptor){
    return new Promise<T | undefined>(resolve=>{
        fs.readFile(path,{encoding:"utf8"},(err,data)=>{
            if(err){
                console.log("Err: ",err);
                resolve(undefined);
            }
            else{
                let obj:T | undefined;
                try{
                    obj = JSON.parse(data);
                }
                catch(err2){
                    console.log("Err: ",err2);
                }
                resolve(obj);
            }
        });
    });
}
export function util_writeJSON(path:fs.PathOrFileDescriptor,data:any){
    return new Promise<void>(resolve=>{
        fs.writeFile(path,JSON.stringify(data,undefined,4),{encoding:"utf8"},()=>{
            resolve();
        });
    });
}
export function util_lstat(path:fs.PathLike){
    return new Promise<fs.Stats|undefined>(resolve=>{
        fs.lstat(path,(err,stats)=>{
            if(err){
                console.log("Err: ",err);
                resolve(undefined);
            }
            else resolve(stats);
        });
    });
}
export function util_mkdir(path:fs.PathLike){
    return new Promise<void>(resolve=>{
        fs.mkdir(path,()=>{
            resolve();
        });
    });
}

// 
export function util_warn(text:string){
    console.log("\x1b[33m%s\x1b[0m","Warn: "+text);
}