import { util_warn } from "./util";

export class Result<T>{
    constructor(data:T,err?:string){
        this.data = data;
        this.err = err;
    }
    isResult = true;
    err?:string;
    private data?:T;

    static err(msg?:string){
        return new Result<any>(undefined,msg);
    }

    unwrap(errCall?:(...args:any[])=>any){
        if(this.err){
            util_warn(this.err);
            if(errCall) errCall(this.err ? this : errors.unknown);
            return;
        }
        if(!this.data){
            if(errCall) errCall(this.err ? this : errors.unknown);
            return;
        }
        return this.data as T;
    }
    unwrapPanick(){
        let data = this.unwrap();
        if(data == null || !data || data == undefined){
            util_warn("Data was undefined");
            return;
        }
        return data;
    }
};

export const errors = {
    unknown: Result.err("Unknown error"),
    invalid_args: Result.err("Invalid arguments"),
    couldNotFindPack: Result.err("Couldn't find pack"),
    failedToReadPack: Result.err("Failed to read pack meta"),
};