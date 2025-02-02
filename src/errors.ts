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
        if(data == null || data == undefined){
            util_warn("Data was undefined");
            return;
        }
        return data;
    }
};

export const errors = {
    unknown: Result.err("Unknown error"),
    invalid_args: Result.err("Invalid arguments"),
    couldNotFindPack: Result.err("Couldn't find mod pack"),
    failedToReadPack: Result.err("Failed to read mod pack meta"),

    noAuthSet: Result.err("The modpack owner has not setup any remote auth yet"),
    noAuthFound: Result.err("Did not find any auth data for your account on this modpack"),
    denyAuth: Result.err("You don't have permission to do this"),

    rpAlreadyExists: Result.err("A resource pack with that name has already been uploaded"),
    couldNotFindRP: Result.err("Could not find resource pack"),
    noDisabledRP: Result.err("You can't upload a disabled resource pack"),

    fileDNE: Result.err("File does not exist"),
    failedToReadStats: Result.err("Failed to read stats of file"),

    // worlds
    alreadyPublishedWorld: Result.err("This world has already been published"),
    worldDNE: Result.err("Couldn't find world"),
    denyWorldDownload: Result.err("You can't download unless you have ownership"),
    denyWorldUpload: Result.err("You can't upload unless you have ownership"),
    alreadyOwnerOfWorld: Result.err("You're already the owner of this world"),
    denyChangeWorldState: Result.err("You can only change the state of a world if you are the owner"),
    denyTakeWorldOwnership: Result.err("The world isn't available to take ownership at this moment"),
    worldIsNotAvailableState: Result.err("The world isn't in an available state at this moment"),
    cantFinishWorldDownload: Result.err("Tried to finish downloading when world wasn't in a downloading state"),
    denyPublisherAuth: Result.err("Only the original publisher of a world can do this"),
    noChangeMade: Result.err("No change was made"),
    denyLaunchFromUnownedWorlds: Result.err("You can't launch an instance that contains worlds that you don't own currently."),
    notAllWorldsAreAvailable: Result.err("No all worlds in this instance are in an available state to use.\n\nPlease wait until all uploads or downloads have finished."),
    noDisabledWorld: Result.err("You can't upload a disabled world"),

    // modpacks
    modpackAlreadyExists: Result.err("A modpack with that name already exists"),
    failedPublishModpack: Result.err("Failed to publish the modpack"),
    modpackDNE: Result.err("Modpack doesn't exist"),

    // 
    noConfig: Result.err("The server's config file isn't loaded yet"),
    noUser: Result.err("Couldn't find your user data on this server"),
};