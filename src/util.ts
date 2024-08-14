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
export function util_readBinary(path:fs.PathOrFileDescriptor){
    return new Promise<Buffer>(resolve=>{
        fs.readFile(path,(err,data)=>{
            resolve(data);
        });
    });
}
export function util_writeJSON(path:fs.PathOrFileDescriptor,data:any){
    return new Promise<boolean>(resolve=>{
        fs.writeFile(path,JSON.stringify(data,undefined,4),{encoding:"utf8"},(err)=>{
            if(err) resolve(false);
            else resolve(true);
        });
    });
}
export function util_writeBinary(path:fs.PathOrFileDescriptor,data:Buffer){
    return new Promise<boolean>(resolve=>{
        fs.writeFile(path,data,(err)=>{
            if(err){
                console.log("Failed to write: ",path,err);
                resolve(false);
            }
            resolve(true);
        });
    });
}
export function util_lstat(path:fs.PathLike){
    return new Promise<fs.Stats|undefined>(resolve=>{
        fs.lstat(path,(err,stats)=>{
            if(err){
                // console.log("Err: ",err);
                resolve(undefined);
            }
            else resolve(stats);
        });
    });
}
export function util_mkdir(path:fs.PathLike,recursive=false){
    return new Promise<boolean>(resolve=>{
        fs.mkdir(path,{
            recursive
        },err=>{
            if(err) resolve(false);
            else resolve(true);
        });
    });
}
export function util_rm(path:fs.PathLike,recursive=false){
    return new Promise<boolean>(resolve=>{
        fs.rm(path,{recursive},(err=>{
            if(err){
                util_warn("Failed to delete file: "+path);
                resolve(false);
            }
            else resolve(true);
        }));
    });
}

export function util_utimes(path:string,ops:{
    mtime:number,
    btime:number,
    atime:number
}){

    if(ops.atime == undefined) ops.atime = 0;

    if(ops.mtime) ops.mtime = Math.floor(ops.mtime);
    if(ops.atime) ops.atime = Math.floor(ops.atime);
    if(ops.btime) ops.btime = Math.floor(ops.btime);

    // console.log("UTIME:",ops,path);

    // console.log("m time:",new Date(ops.mtime).toLocaleString());
    // console.log("b time:",new Date(ops.btime).toLocaleString());

    return new Promise<boolean>(resolve=>{
        fs.utimes(path,ops.atime/1000,ops.mtime/1000,err=>{
            if(err){
                util_warn("Error occured while changing timestamps:");
                console.log(err);
                resolve(false);
            }
            else resolve(true);
        });
    });

    // return new Promise<boolean>(resolve=>{
    //     utimes(path,{
    //         atime:ops.atime,
    //         btime:ops.btime,
    //         mtime:ops.mtime
    //     },err=>{
    //         if(err){
    //             util_warn("Error occured while changing timestamps:");
    //             console.log(err);
    //             resolve(false);
    //         }
    //         else resolve(true);
    //     });
    // });
}

// 
export function util_warn(text:string){
    console.log("\x1b[33m%s\x1b[0m","Warn: "+text);
}