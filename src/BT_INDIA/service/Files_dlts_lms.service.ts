import {BT_Uploadfilesdltslms} from '../entities/Uploaded_files_dlts_lms.entity';
import { getRepository } from '../../database/connection';

export class Files_dltslms{

    private static getFiles_dltslmsRepo(){
        return getRepository(BT_Uploadfilesdltslms);
    }

    static async insertFiles_dltslms(FilesdltslmsData : Partial<BT_Uploadfilesdltslms>): Promise <BT_Uploadfilesdltslms>{
        const repository = this.getFiles_dltslmsRepo();

        const Files_lmsins=repository.create({
            ...FilesdltslmsData
        });

        return await repository.save(Files_lmsins);
    }
};