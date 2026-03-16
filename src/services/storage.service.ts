// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
//   InternalServerErrorException
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository, DataSource, Between, Like } from 'typeorm';
// import { MntStorageHdr } from '../entities/mntstorage-hdr.entity';
// // import {
// //   CreateStorageHdrDto,
// //   UpdateStorageHdrDto,
// //   StorageHdrFilterDto,
// //   AutomatedStorageComputationDto
// // } from '../dto/storage-hdr.dto';

// @Injectable()
// export class StorageHdrService {
//   constructor(
//     @InjectRepository(MntStorageHdr)
//     private readonly storageHdrRepository: Repository<MntStorageHdr>,
//     private readonly dataSource: DataSource
//   ) {}

//   // ─── Create ───────────────────────────────────────────────────────────────

//   async create(dto: CreateStorageHdrDto): Promise<MntStorageHdr> {
//     try {
//       // Validate date range
//       const startDate = new Date(dto.invstartdate);
//       const endDate = new Date(dto.invenddate);

//       if (endDate <= startDate) {
//         throw new BadRequestException(
//           'Invoice End Date must be after Invoice Start Date.'
//         );
//       }

//       // Check for duplicate entry (same prin_code + storagemonth)
//       const existing = await this.storageHdrRepository.findOne({
//         where: {
//           prin_code: dto.prin_code,
//           storagemonth: dto.storagemonth
//         }
//       });

//       if (existing) {
//         throw new BadRequestException(
//           `Storage record already exists for Principal '${dto.prin_code}' in month '${dto.storagemonth}'.`
//         );
//       }

//       const entity = this.storageHdrRepository.create({
//         ...dto,
//         invstartdate: startDate,
//         invenddate: endDate,
//         userdate: dto.userdate ? new Date(dto.userdate) : new Date()
//       });

//       return await this.storageHdrRepository.save(entity);
//     } catch (error) {
//       if (
//         error instanceof BadRequestException ||
//         error instanceof NotFoundException
//       ) {
//         throw error;
//       }
//       throw new InternalServerErrorException(
//         `Failed to create storage record: ${error.message}`
//       );
//     }
//   }

//   // ─── Find All (with filters + pagination) ─────────────────────────────────

//   async findAll(
//     filterDto: StorageHdrFilterDto
//   ): Promise<{ data: MntStorageHdr[]; total: number; page: number; limit: number }> {
//     const { prin_code, company_code, storagemonth, invstartdate_from, invstartdate_to, page = 1, limit = 50 } = filterDto;

//     const queryBuilder = this.storageHdrRepository
//       .createQueryBuilder('s')
//       .orderBy('s.mnthstorageno', 'DESC')
//       .skip((page - 1) * limit)
//       .take(limit);

//     if (prin_code) {
//       queryBuilder.andWhere('s.prin_code = :prin_code', { prin_code });
//     }

//     if (company_code) {
//       queryBuilder.andWhere('s.company_code = :company_code', { company_code });
//     }

//     if (storagemonth) {
//       queryBuilder.andWhere('s.storagemonth = :storagemonth', { storagemonth });
//     }

//     if (invstartdate_from && invstartdate_to) {
//       queryBuilder.andWhere(
//         's.invstartdate BETWEEN :invstartdate_from AND :invstartdate_to',
//         {
//           invstartdate_from: new Date(invstartdate_from),
//           invstartdate_to: new Date(invstartdate_to)
//         }
//       );
//     } else if (invstartdate_from) {
//       queryBuilder.andWhere('s.invstartdate >= :invstartdate_from', {
//         invstartdate_from: new Date(invstartdate_from)
//       });
//     } else if (invstartdate_to) {
//       queryBuilder.andWhere('s.invstartdate <= :invstartdate_to', {
//         invstartdate_to: new Date(invstartdate_to)
//       });
//     }

//     const [data, total] = await queryBuilder.getManyAndCount();

//     return { data, total, page, limit };
//   }

//   // ─── Find One ─────────────────────────────────────────────────────────────

//   async findOne(mnthstorageno: number): Promise<MntStorageHdr> {
//     const record = await this.storageHdrRepository.findOne({
//       where: { mnthstorageno }
//     });

//     if (!record) {
//       throw new NotFoundException(
//         `Storage record with MNTHSTORAGENO '${mnthstorageno}' not found.`
//       );
//     }

//     return record;
//   }

//   // ─── Find by Principal ────────────────────────────────────────────────────

//   async findByPrincipal(
//     prin_code: string,
//     company_code?: string
//   ): Promise<MntStorageHdr[]> {
//     const where: any = { prin_code };
//     if (company_code) where.company_code = company_code;

//     return this.storageHdrRepository.find({
//       where,
//       order: { mnthstorageno: 'DESC' }
//     });
//   }

//   // ─── Update ───────────────────────────────────────────────────────────────

//   async update(
//     mnthstorageno: number,
//     dto: UpdateStorageHdrDto
//   ): Promise<MntStorageHdr> {
//     const record = await this.findOne(mnthstorageno);

//     if (dto.invstartdate && dto.invenddate) {
//       const startDate = new Date(dto.invstartdate);
//       const endDate = new Date(dto.invenddate);

//       if (endDate <= startDate) {
//         throw new BadRequestException(
//           'Invoice End Date must be after Invoice Start Date.'
//         );
//       }
//     }

//     const updated = this.storageHdrRepository.merge(record, {
//       ...dto,
//       invstartdate: dto.invstartdate ? new Date(dto.invstartdate) : record.invstartdate,
//       invenddate: dto.invenddate ? new Date(dto.invenddate) : record.invenddate,
//       userdate: dto.userdate ? new Date(dto.userdate) : new Date()
//     });

//     return this.storageHdrRepository.save(updated);
//   }

//   // ─── Delete ───────────────────────────────────────────────────────────────

//   async remove(mnthstorageno: number): Promise<{ message: string }> {
//     const record = await this.findOne(mnthstorageno);
//     await this.storageHdrRepository.remove(record);

//     return { message: `Storage record '${mnthstorageno}' deleted successfully.` };
//   }

//   // ─── Get Last Invoice Date for a Principal ────────────────────────────────

//   async getLastInvoiceDate(
//     prin_code: string,
//     company_code: string
//   ): Promise<{ prin_code: string; last_invoice_date: Date | null }> {
//     const result = await this.storageHdrRepository
//       .createQueryBuilder('s')
//       .select('MAX(s.invenddate)', 'last_invoice_date')
//       .where('s.prin_code = :prin_code', { prin_code })
//       .andWhere('s.company_code = :company_code', { company_code })
//       .getRawOne();

//     return {
//       prin_code,
//       last_invoice_date: result?.last_invoice_date ?? null
//     };
//   }

//   // ─── Automated Storage Computation ────────────────────────────────────────
//   // Mirrors the "Automated Storage Computation" grid in the UI:
//   // Computes storage charges for a principal from last invoice date to current date.

//   async computeAutomatedStorage(
//     prin_code: string,
//     company_code: string,
//     current_date?: string
//   ): Promise<AutomatedStorageComputationDto[]> {
//     try {
//       const { last_invoice_date } = await this.getLastInvoiceDate(
//         prin_code,
//         company_code
//       );

//       const toDate = current_date ? new Date(current_date) : new Date();
//       const fromDate = last_invoice_date ?? toDate;

//       // Query existing storage records in the range for this principal
//       const records = await this.storageHdrRepository
//         .createQueryBuilder('s')
//         .where('s.prin_code = :prin_code', { prin_code })
//         .andWhere('s.company_code = :company_code', { company_code })
//         .andWhere('s.invstartdate >= :fromDate', { fromDate })
//         .andWhere('s.invenddate <= :toDate', { toDate })
//         .orderBy('s.invstartdate', 'ASC')
//         .getMany();

//       return records.map((r) => ({
//         prin_code: r.prin_code,
//         inv_from_date: r.invstartdate?.toISOString() ?? '',
//         inv_to_date: r.invenddate?.toISOString() ?? '',
//         chargetype: r.chargetype ?? '',
//         charge_time: r.nodays ?? 0,
//         processed: r.username ? 'Y' : 'N',
//         user_id: r.username ?? '',
//         user_dt: r.userdate?.toISOString() ?? ''
//       }));
//     } catch (error) {
//       if (error instanceof NotFoundException) throw error;
//       throw new InternalServerErrorException(
//         `Automated computation failed: ${error.message}`
//       );
//     }
//   }

//   // ─── Get Summary for Storage Month Header ─────────────────────────────────
//   // Returns Site Ind / Foc / Charge Time / Cpu / Amt Lumpsum summary row

//   async getStorageMonthSummary(
//     prin_code: string,
//     storagemonth: number,
//     company_code: string
//   ): Promise<{
//     site_ind: string;
//     foc: string;
//     charge_time: number;
//     cpu: number;
//     amt_lumpsum: number;
//   }> {
//     // Execute a raw aggregate query for the month summary
//     const result = await this.dataSource.query(
//       `SELECT
//          NVL(SUM(NODAYS), 0)     AS charge_time,
//          NVL(AVG(NODAYS), 0)     AS cpu,
//          NVL(SUM(
//            CASE WHEN CHARGETYPE = 'L' THEN NODAYS ELSE 0 END
//          ), 0)                   AS amt_lumpsum
//        FROM MNTSTORAGE_HDR
//        WHERE PRIN_CODE    = :1
//          AND STORAGEMONTH = :2
//          AND COMPANY_CODE = :3`,
//       [prin_code, storagemonth, company_code]
//     );

//     const row = result?.[0] ?? {};

//     return {
//       site_ind: '',       // Populate from your business logic / related table
//       foc: '',            // Populate from your business logic / related table
//       charge_time: Number(row.charge_time ?? 0),
//       cpu: Number(row.cpu ?? 0),
//       amt_lumpsum: Number(row.amt_lumpsum ?? 0)
//     };
//   }
// }