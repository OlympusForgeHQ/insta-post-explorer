import {createTempWorkdirManager} from '../runtime/temp-workdir.js';

// The host unit holds the classifier's exclusive flock before entering Node.
// All directories in this private media root belong to the stopped predecessor;
// the model cache lives outside it and is never cleaned here.
export async function prepareClassificationWorkdirs(root:string){
 const workdirs=createTempWorkdirManager({root,maxAgeMs:21_600_000});
 await workdirs.cleanupStale(new Date(),true);
 return workdirs;
}
