import { PackManifest } from "@modsync/shared";
import { Router } from "express";
import path from "path";

const router = Router();

const tmpManifest:PackManifest = {
    id:"test-pack",
    name:"Test Pack",
    version:"1.0.0",
    files:[
        // {
        //     path:"mods/example.jar",
        //     sha256:"abc123...",
        //     size:12345
        // }
    ],
    managed_paths:[
        "mods"
    ]
};

router.get("/v2/manifest",(req,res)=>{
    res.json(tmpManifest);
});

router.get("/v2/files/:filePath(*)",(req,res)=>{
    const filePath = req.params.filePath;
    res.sendFile(path.join(__dirname,"tests","files",filePath));
});

export default router;