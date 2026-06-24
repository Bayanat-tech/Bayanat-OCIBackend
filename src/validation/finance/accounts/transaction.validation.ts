import Joi from "joi";
import constants from "../../../helpers/constants";

export const chequePaymentSchema = (
  data: any,
  userCompany?: string,
  isBulkOperation?: boolean
) => {
  const baseSchema = Joi.object({
    doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow("", null).custom((v, h) => v == null ? v : String(v)), // Document number (optional, casts to string)
    doc_type: Joi.string()
      .valid(
        constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
        constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
        constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
        constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
        constants.TRANSACTION_DOCUMENT_TYPE.LPO,
        constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT,
        constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
        constants.TRANSACTION_DOCUMENT_TYPE.DEBIT_NOTE,
      )
      .required(),
    bank_ac_code: Joi.string().when("doc_type", {
      is: constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
      then: Joi.forbidden(),
      otherwise: Joi.allow("", null),
    }),
    cheque_bank: Joi.string().when("doc_type", {
      is: constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
      then: Joi.forbidden(),
      otherwise: Joi.allow("", null),
    }),
    cheque_no: Joi.string().when("doc_type", {
      is: constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
      then: Joi.forbidden(),
      otherwise: Joi.allow("", null),
    }),
    cheque_date: Joi.date().when("doc_type", {
      is: constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
      then: Joi.forbidden(), // Then cheque date is forbidden
      otherwise: Joi.allow("", null), // Otherwise cheque date is optional
    }),
    ac_code: Joi.string().required(), // Account code (required)
    doc_date: Joi.date(), // Document date
    remarks: Joi.string().optional().allow("", null), // Remarks (optional)
    ex_rate: Joi.number().default(1), // Exchange rate (default 1)
    curr_code: Joi.string().required(), // Currency code (required)
    // files: Joi.array().optional().allow("", null) // Files (conditional)
    //   .items(Joi.any())
    //   .when("doc_type", {
    //     is: constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT, // If document type is cheque payment
    //     then: Joi.allow(null, ""), // Then files are optional
    //     otherwise: Joi.forbidden(), // Otherwise files are forbidden
    //   }),
    files: Joi.array()
      .items(Joi.any())
      .optional()
      .allow(null, ""),
    ac_payee: Joi.string().when("doc_type", {
      is: Joi.valid(
        constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
        constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
        constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT
      ),
      then: Joi.allow("", null),
      otherwise: Joi.forbidden(),
    }),
    ref_no: Joi.number().optional().allow("", null),
    ref_date: Joi.date().optional().allow("", null),
    inv_date: Joi.date().optional().allow("", null), // Document date
    supplier: Joi.string().optional().allow("", null),
    party_address: Joi.string().optional().allow("", null),
    party_phone: Joi.number().optional().allow("", null),
    mobile: Joi.number().optional().allow("", null),
    party_fax: Joi.string().optional().allow("", null),
    fy_code: Joi.number().optional().allow("", null), // Fiscal year code 
    hse_compliance: Joi.string().optional().allow("", null),
    terms: Joi.string().optional().allow("", null), // Payment terms
    delivery_info: Joi.date().optional().allow("", null),
    delivery_term: Joi.string().optional().allow("", null),
    contact: Joi.number().optional().allow("", null),
    email: Joi.string().email().optional().allow("", null),
    app_ref_no: Joi.number().optional().allow("", null),
    tax_category: Joi.string().optional().allow("", null),
    tax_code: Joi.number().optional().allow("", null),
    tax_type: Joi.string().optional().allow("", null),
    div_code: Joi.string().required(), // Division code (required)
    ...(isBulkOperation && { company_code: userCompany }), // Company code (conditional)
    detail: Joi.array() // Detail (required)
      .items(
        Joi.object({
          Account: Joi.object({
            ac_name: Joi.string()
          }).optional(),
          Currency: Joi.object({
            curr_name: Joi.string()
          }).optional(),
          Department: Joi.object({
            dept_name: Joi.string().optional().allow("", null)
          }).optional().allow("", null),
          qty: Joi.number().optional().allow("", null),
          price: Joi.number().optional().allow("", null),
          doc_date: Joi.date(), // Document date
          company_code: Joi.string().required(), // Company code (required)
          ac_code: Joi.string().required(), // Account code (required)
          remarks: Joi.string().optional().allow("", null), // Remarks (optional)
          curr_code: Joi.string().required(), // Currency code (required)
          ex_rate: Joi.number(), // Exchange rate
          amount: Joi.number().required(), // Amount (required)
          sign_ind: Joi.number().valid(-1, 1).allow(null), // Sign indicator (optional)
          tx_compntcat_code_1: Joi.string().allow(null, ""), // Transaction component category code 1 (optional)
          tx_compnt_1_expmt: Joi.string().optional().allow("", null), // Transaction component 1 expense (optional)
          tx_compnt_perc_1: Joi.number().allow(null), // Transaction component 1 percentage (optional)
          tx_compnt_amt_1: Joi.number().allow(null), // Transaction component 1 amount (optional)
          job_no: Joi.string().optional().allow("", null), // Job number (optional)
          dept_code: Joi.string().allow("", null), // Department code (optional)
          lcur_amount: Joi.number().allow("", null), // Local currency amount (optional)
          tx_compnt_lcuramt_1: Joi.number().allow("", null), // Transaction component 1 local currency amount (optional)
          tx_cat_code: Joi.string().allow("", null), // Transaction category code (optional)
          ref_no: Joi.number().optional().allow("", null),
          div_code: Joi.string().required(), // Division code (required)
          doc_no: Joi.string().required(), // Document number (required)
          doc_type: Joi.string() // Document type (required)
            .valid(
              constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT, // Cheque payment
              constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT, // Cheque receipt
              constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,// Cash receipt
              constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE, // Purchase
              constants.TRANSACTION_DOCUMENT_TYPE.LPO, // LPO
              constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT,// Petty cash payment
              constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
              constants.TRANSACTION_DOCUMENT_TYPE.DEBIT_NOTE,
            )
            .required(),
          serial_no: Joi.number().required(), // Serial number (required),
        })
      )
      .min(1) // Minimum 1 detail item
      .required() // Detail is required
      .custom((value, helper) => {
        // Ensure 'doc_type' in 'detail' matches the root 'doc_type' and validate CR-specific constraints
        const rootDocType = helper.state.ancestors[0].doc_type;
        for (const item of value) {
          if (item.doc_type !== rootDocType) {
            throw new Error("doc_type in detail must match root doc_type");
          }
          // If root is Cash Receipt (CR), disallow cheque/bank fields at detail level
          if (
            rootDocType === constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT &&
            (item.cheque_no || item.cheque_date || item.cheque_bank || item.bank_ac_code)
          ) {
            throw new Error("Cheque/bank fields are not allowed for Cash Receipt in detail lines");
          }
        }
        return value;
      }),
    children: Joi.object({
      // Invoice details
      invoice: Joi.array()
        .items(
          Joi.object({
            // Document date
            doc_date: Joi.date(),
            // Account code (required)
            ac_code: Joi.string().required(),
            // Is deletable (optional, default false)
            IsDeletable: Joi.boolean().optional().default(false),
            // Serial number (required)
            serial_no: Joi.number().optional(),
            // UI id (frontend internal id)
            id: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
                constants.TRANSACTION_DOCUMENT_TYPE.LPO,
                constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
                constants.TRANSACTION_DOCUMENT_TYPE.DEBIT_NOTE,
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Invoice number (optional)
            inv_no: Joi.string().allow("", null).allow("", null),
            // Display document number (UI-only)
            display_doc_no: Joi.string().optional().allow("", null),
            // Invoice date (optional)
            inv_date: Joi.date().allow(null).optional(),
            // Document date (optional)
            due_date: Joi.date().allow(null).optional(),
            chq_date: Joi.date().allow(null).optional(),
            chq_bank: Joi.string().allow(null).optional(),
            chq_no: Joi.string().allow(null).optional(),
            inv_amt: Joi.number().allow(null).optional(),
            indicator_origin: Joi.string().default('Y'),
            amount_origin: Joi.number().allow(null).optional(),
            // Current balance amount (optional)
            c_bal_amt_org: Joi.number().allow(null).optional(),
            // Amount (optional, default 0)
            amount: Joi.number().default(0).optional(),
            // Local currency amount (optional, default 0)
            lcur_amount: Joi.number().default(0).optional(),
            // Selection flag from UI
            isSelected: Joi.boolean().optional(),
            // Currency code (optional)
            curr_code: Joi.string().allow(null).optional(),
            // Currency display name (UI-only)
            curr_name: Joi.string().optional().allow("", null),
            // Exchange rate (optional)
            ex_rate: Joi.number().allow(null).optional(),
            // Current currency amount (optional)
            c_curr_amt: Joi.number().allow(null).optional(),
            ref_no: Joi.number().optional().allow("", null),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'invoice' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in invoice must match root doc_type");
            }
          }
          return value;
        }),

      // Job details
      job: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // UI id (frontend internal id)
            id: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
                constants.TRANSACTION_DOCUMENT_TYPE.LPO,
                constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
                constants.TRANSACTION_DOCUMENT_TYPE.DEBIT_NOTE,
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Job number (optional)
            job_no: Joi.string().allow("", null).optional(),
            // Document reference number (optional)
            doc_refno: Joi.string().allow("", null).optional(),
            // Display document number (UI-only)
            display_doc_no: Joi.string().optional().allow("", null),
            // Document reference number 2 (optional)
            doc_refno_2: Joi.string().allow("", null).optional(),
            // Amount (optional)
            amount: Joi.number().allow(null).optional(),
            // Local currency amount and UI selection
            lcur_amount: Joi.number().default(0).optional(),
            curr_code: Joi.string().allow(null).optional(),
            // Currency display name (UI-only)
            curr_name: Joi.string().optional().allow("", null),
            isSelected: Joi.boolean().optional(),
            // Exchange rate (optional)
            ex_rate: Joi.number().allow(null).optional(),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'job' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in job must match root doc_type");
            }
          }
          return value;
        }),

      // Expense details
      expense: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // UI id (frontend internal id)
            id: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
                constants.TRANSACTION_DOCUMENT_TYPE.LPO,
                constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CREDIT_NOTE,
                constants.TRANSACTION_DOCUMENT_TYPE.DEBIT_NOTE
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Expense type code (required)
            exp_type_code: Joi.string().required(),
            // Expense subtype code (optional)
            exp_subtype_code: Joi.string().optional().allow("", null),
            // Expense subtype description (optional)
            exp_subtype_description: Joi.string().optional().allow("", null),
            // Expense code (optional)
            exp_code: Joi.string().optional().allow("", null),
            // Expense description (optional)
            exp_description: Joi.string().optional().allow("", null),
            // Job number (optional)
            job_no: Joi.string().optional().allow("", null),
            // Amount (required)
            amount: Joi.number(),
            // Exchange rate (optional from UI)
            ex_rate: Joi.number().allow(null).optional(),
            // Display document number (UI-only)
            display_doc_no: Joi.string().optional().allow("", null),
            // Optional local currency amount and UI selection flag
            lcur_amount: Joi.number().optional(),
            curr_code: Joi.string().allow(null).optional(),
            // Currency display name (UI-only)
            curr_name: Joi.string().optional().allow("", null),
            isSelected: Joi.boolean().optional(),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'expense' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in expense must match root doc_type");
            }
          }
          return value;
        }),
    }).optional(),
  });// Define the Joi schema for the cheque payment document
  const schema = Joi.array().items(baseSchema);
  // Validate the data using the schema, depending on whether it's a bulk operation
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
};

export const purchaseSchema = (
  data: any,
  userCompany?: string,
  isBulkOperation?: boolean
) => {
  const baseSchema = Joi.object({
    // Define the Joi schema for the cheque payment document
    doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow("", null).custom((v, h) => v == null ? v : String(v)), // Document number (optional)
    doc_type: Joi.string() // Document type (required)
      .valid(
        constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE, // Cheque payment
        constants.TRANSACTION_DOCUMENT_TYPE.SALES,
        constants.TRANSACTION_DOCUMENT_TYPE.SERVICE_INVOICE, // Cheque payment
      )
      .required(),
    div_name: Joi.string().optional().allow('', null),
    ac_name: Joi.string().optional().allow('', null),
    inv_no: Joi.string().optional().allow('', null),
    inv_date: Joi.date(),
    address: Joi.string().optional().allow("", null),
    supplier: Joi.string().optional().allow("", null),
    company_code: Joi.string().optional().allow("", null),
    dlvr_contact: Joi.string().optional().allow("", null),
    phone: Joi.string().optional().allow("", null),
    dlvr_mobile: Joi.string().optional().allow("", null),
    fax: Joi.string().optional().allow("", null),
    ac_code: Joi.string().required(),
    doc_date: Joi.date(), // Document date
    remarks: Joi.string().optional().allow("", null), // Remarks (optional)
    ex_rate: Joi.number().default(1), // Exchange rate (default 1)
    price: Joi.number().default(1), // Price (default 1)
    qty: Joi.number().default(1), // Quantity (default 1)
    curr_code: Joi.string().required(), // Currency code (required)
    party_address: Joi.string().optional().allow("", null),
    party_phone: Joi.string().optional().allow("", null),
    party_fax: Joi.string().optional().allow("", null),
    ref_doc_no: Joi.string().optional().allow("", null),
    payment_terms: Joi.string().optional().allow("", null),
    files: Joi.array().optional().allow("", null),
    ref_no: Joi.string().optional().allow("", null),
    ref_date: Joi.date().optional().allow("", null),
    delivery_info: Joi.date().optional().allow("", null),
    delivery_term: Joi.string().optional().allow("", null),
    dlvr_term: Joi.string().optional().allow("", null),
    doc_path: Joi.array() // Files (conditional)
      .items(Joi.any())
      .when("doc_type", {
        is: constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
        then: Joi.allow(null, ""),
        otherwise: Joi.forbidden(),
      }),
    tax_categoty: Joi.number().optional(),
    tax_category: Joi.string().optional().allow("", null),
    tax_code: Joi.number().optional().allow("", null),
    tax_percentage: Joi.number().optional().allow("", null),
    tx_cat_code: Joi.string().optional().allow("", null),
    tx_compntcat_code_1: Joi.string().optional().allow("", null),
    tx_compncat_code_1: Joi.string().optional().allow("", null),
    tx_compnt_1_expmt: Joi.string().optional().allow("", null),
    tx_compnt_perc_1: Joi.number().optional().allow("", null),
    tx_compnt_amt_1: Joi.number().optional().allow("", null),
    tax_type: Joi.string().optional().allow("", null),
    ac_payee: Joi.string().when("doc_type", { // Account payee (conditional)
      is: constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT, // If document type is cheque payment
      then: Joi.allow("", null), // Then account payee is optional
      otherwise: Joi.forbidden(), // Otherwise account payee is forbidden
    }),
    div_code: Joi.string().required(), // Division code (required)
    terms: Joi.string().optional().allow("", null),
    dlvr_email: Joi.string().email().optional().allow("", null),
    app_ref_no: Joi.string().optional().allow("", null),
    fy_code: Joi.string().optional().allow("", null),
    //hse_compliance: Joi.string().optional().allow("", null),
    hse_compliance: Joi.any().optional().allow(null, ""),
    invoice_no: Joi.string().optional().allow("", null),
    ...(isBulkOperation && { company_code: userCompany }), // Company code (conditional)
    detail: Joi.array() // Detail (required)
      .items(
        Joi.object({
          doc_date: Joi.date(), // Document date
          company_code: Joi.string().required(), // Company code (required)
          ac_code: Joi.string().required(), // Account code (required)
          remarks: Joi.string().optional().allow("", null), // Remarks (optional)
          curr_code: Joi.string().required(), // Currency code (required)
          ex_rate: Joi.number(), // Exchange rate
          price: Joi.number().default(1), // Price (default 1)
          qty: Joi.number().default(1), // Quantity (default 1)
          amount: Joi.number().required(), // Amount (required)
          project: Joi.string(), // Amount (required)
          ac_name: Joi.string(),
          //sign_ind: Joi.number().valid(1).allow(null), // Sign indicator (optional)
          sign_ind: Joi.number().integer()
                 .required()
                 .when('doc_type', {
                 is: constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
                  then: Joi.valid(1),
                  otherwise: Joi.valid(-1) // SALES + SERVICE_INVOICE
                }),
          tx_compntcat_code_1: Joi.string().allow(null, ""), // Transaction component category code 1 (optional)
          tx_compnt_1_expmt: Joi.string().allow(null), // Transaction component 1 expense (optional)
          tx_compnt_perc_1: Joi.number().allow(null), // Transaction component 1 percentage (optional)
          tx_compnt_amt_1: Joi.number().allow(null), // Transaction component 1 amount (optional)
          job_no: Joi.string().optional().allow("", null), // Job number (optional)
          dept_code: Joi.string().optional().allow("", null), // Department code (optional)
          lcur_amount: Joi.number().optional().allow("", null), // Local currency amount (optional)
          tx_compnt_lcuramt_1: Joi.number().optional().allow("", null), // Transaction component 1 local currency amount (optional)
          tx_cat_code: Joi.string().optional().allow("", null), // Transaction category code (optional)
          div_code: Joi.string().required(), // Division code (required)
          doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).required().custom((v, h) => v == null ? v : String(v)), // Document number (required)
          doc_type: Joi.string() // Document type (required)
            .valid(
              constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE, // Cheque payment
              constants.TRANSACTION_DOCUMENT_TYPE.SALES,
              constants.TRANSACTION_DOCUMENT_TYPE.SERVICE_INVOICE,
            )
            .required(),
          serial_no: Joi.number().required(), // Serial number (required)
        }).unknown(true)
      )
      .min(1) // Minimum 1 detail item
      .required() // Detail is required
      .custom((value, helper) => {
        // Ensure 'doc_type' in 'detail' matches the root 'doc_type' and validate CR-specific constraints
        const rootDocType = helper.state.ancestors[0].doc_type;
        for (const item of value) {
          if (item.doc_type !== rootDocType) {
            throw new Error("doc_type in detail must match root doc_type");
          }
          // If root is Cash Receipt (CR), disallow cheque/bank fields at detail level
          if (
            rootDocType === constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT &&
            (item.cheque_no || item.cheque_date || item.cheque_bank || item.bank_ac_code)
          ) {
            throw new Error("Cheque/bank fields are not allowed for Cash Receipt in detail lines");
          }
        }
        return value;
      }),
    children: Joi.object({
      // Invoice details
      invoice: Joi.array()
        .items(
          Joi.object({
            // Document date
            doc_date: Joi.date(),
            // Account code (required)
            ac_code: Joi.string().required(),
            // Is deletable (optional, default false)
            IsDeletable: Joi.boolean().optional().default(false),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            // sign_ind: Joi.number()
            //   .integer()
            //   .valid(-1)
            //   .required(),

            sign_ind: Joi.number()
              .integer()
              .required()
              .when('doc_type', {
                is: constants.TRANSACTION_DOCUMENT_TYPE.PURCHASE,
                then: Joi.valid(-1),
                otherwise: Joi.valid(1) // SALES + SERVICE_INVOICE
              }),
            // Invoice number (optional)
            inv_no: Joi.string().allow("", null).allow("", null),
            // Invoice date (optional)
            inv_date: Joi.date().allow(null).optional(),
            // Invoice amount (optional)
            inv_amt: Joi.number().allow(null).optional(),
            // Current balance amount (optional)
            c_bal_amt_org: Joi.number().allow(null).optional(),
            // Amount (optional, default 0)
            amount: Joi.number().default(0).optional(),
            // Local currency amount (optional, default 0)
            lcur_amount: Joi.number().default(0).optional(),
            // Currency code (optional)
            curr_code: Joi.string().allow(null).optional(),
            // Exchange rate (optional)
            ex_rate: Joi.number().allow(null).optional(),
            price: Joi.number(),
            qty: Joi.number().allow("", null),
            ref_no: Joi.number().optional().allow("", null),
            // Current currency amount (optional)
            c_curr_amt: Joi.number().allow(null).optional(),
            amount_origin: Joi.number().default(0).optional(),
            indicator_origin: Joi.string().default('Y'),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'invoice' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in invoice must match root doc_type");
            }
          }
          return value;
        }),

      // Job details
      job: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Job number (optional)
            job_no: Joi.string().allow("", null).optional(),
            // Document reference number (optional)
            doc_refno: Joi.string().allow("", null).optional(),
            // Document reference number 2 (optional)
            doc_refno_2: Joi.string().allow("", null).optional(),
            // Amount (optional)
            amount: Joi.number().allow(null).optional(),
            price: Joi.number().optional().allow("", null),
            qty: Joi.number().optional().allow("", null),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'job' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in job must match root doc_type");
            }
          }
          return value;
        }),

      // Expense details
      expense: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, "").custom((v, h) => v == null ? v : String(v)),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT,
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Expense type code (required)
            exp_type_code: Joi.string().required(),
            // Expense subtype code (optional)
            exp_subtype_code: Joi.string().optional().allow("", null),
            // Expense subtype description (optional)
            exp_subtype_description: Joi.string().optional().allow("", null),
            // Expense code (optional)
            exp_code: Joi.string().optional().allow("", null),
            // Expense description (optional)
            exp_description: Joi.string().optional().allow("", null),
            // Job number (optional)
            job_no: Joi.string().optional().allow("", null),
            // Amount (required)
            amount: Joi.number(),
            price: Joi.number().optional().allow("", null),
            qty: Joi.number().optional().allow("", null),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'expense' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in expense must match root doc_type");
            }
          }
          return value;
        }),
    }).optional(),
  });// Define the Joi schema for the cheque payment document
  const schema = Joi.array().items(baseSchema);
  // Validate the data using the schema, depending on whether it's a bulk operation
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
};

export const salesSchema = (
  data: any,
  userCompany?: string,
  isBulkOperation?: boolean
) => {
  const baseSchema = Joi.object({
    // Define the Joi schema for the cheque payment document
    doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow("", null).custom((v, h) => v == null ? v : String(v)), // Document number (optional)
    doc_type: Joi.string() // Document type (required)
      .valid(
        constants.TRANSACTION_DOCUMENT_TYPE.SALES,
        constants.TRANSACTION_DOCUMENT_TYPE.SERVICE_INVOICE, // Cheque payment
      )
      .required(),
    inv_no: Joi.string().optional().allow('', null),
    inv_date: Joi.date().optional().allow("", null), // Otherwise cheque date is optional
    ac_code: Joi.string().required(), // Account code (required)
    doc_date: Joi.date(), // Document date
    remarks: Joi.string().optional().allow("", null), // Remarks (optional)
    ex_rate: Joi.number().default(1), // Exchange rate (default 1)
    curr_code: Joi.string().required(), // Currency code (required)
    salesman_code: Joi.string().optional().allow("", null),
    salesman_name: Joi.string().optional().allow("", null),
    sector_code: Joi.string().optional().allow("", null),
    sector_name: Joi.string().optional().allow("", null),
    address: Joi.string().optional().allow("", null),
    phone: Joi.string().optional().allow("", null),
    party_address: Joi.string().optional().allow("", null),
    party_phone: Joi.string().optional().allow("", null),
    party_fax: Joi.string().optional().allow("", null),
    dlvr_email: Joi.string().email().optional().allow("", null),
    dlvr_contact: Joi.string().optional().allow("", null),
    dlvr_mobile: Joi.string().optional().allow("", null),
    ref_doc_no: Joi.string().optional().allow("", null),
    ref_no: Joi.string().optional().allow("", null),
    payment_terms: Joi.string().optional().allow("", null),
    tx_compnt_1_expmt: Joi.string().optional().allow("", null),
    tax_type: Joi.string().optional().allow("", null),
    tx_cat_code: Joi.string().optional().allow("", null),
    tx_compntcat_code_1: Joi.string().optional().allow("", null),
    tx_compnt_perc_1: Joi.number().optional().allow("", null),
    tx_compnt_amt_1: Joi.number().optional().allow("", null),
    files: Joi.array().optional().allow("", null),
    hse_compliance: Joi.any().optional().allow(null, ""),
    party_name: Joi.string().optional().allow("", null),
    doc_path: Joi.array() // Files (conditional)
      .items(Joi.any())
      .when("doc_type", {
        is: constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT, // If document type is cheque payment
        then: Joi.allow(null, ""), // Then files are optional
        otherwise: Joi.forbidden(), // Otherwise files are forbidden
      }),
    tax_categoty: Joi.number().optional(),
    tax_code: Joi.number().optional().allow("", null),
    // tax_type: Joi.string().optional().allow("", null),
    ac_payee: Joi.string().when("doc_type", { // Account payee (conditional)
      is: constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT, // If document type is cheque payment
      then: Joi.allow("", null), // Then account payee is optional
      otherwise: Joi.forbidden(), // Otherwise account payee is forbidden
    }),
    div_name: Joi.string().optional().allow('', null),
    ac_name: Joi.string().optional().allow('', null),
    div_code: Joi.string().required(), // Division code (required)
    ...(isBulkOperation && { company_code: userCompany }), // Company code (conditional)
    detail: Joi.array() // Detail (required)
      .items(
        Joi.object({
          doc_date: Joi.date(), // Document date
          company_code: Joi.string().required(), // Company code (required)
          ac_code: Joi.string().required(), // Account code (required)
          remarks: Joi.string().optional().allow("", null), // Remarks (optional)
          curr_code: Joi.string().required(), // Currency code (required)
          ex_rate: Joi.number(), // Exchange rate
          qty: Joi.number().default(1), // Quantity (default 1)
          price: Joi.number().default(1), // Price (default 1)
          description: Joi.string().optional().allow("", null),
          amount: Joi.number().required(), // Amount (required)
          project: Joi.string(), // Amount (required)
          ac_name: Joi.string(),
          sign_ind: Joi.number().valid(-1,1).allow(null), // Sign indicator (optional)
          tx_compntcat_code_1: Joi.string().optional().allow("", null), // Transaction component category code 1 (optional)
          tx_compnt_1_expmt: Joi.string().optional().allow("", null), // Transaction component 1 expense (optional)
          tx_compnt_perc_1: Joi.number().optional().allow("", null), // Transaction component 1 percentage (optional)
          tx_compnt_amt_1: Joi.number().optional().allow("", null), // Transaction component 1 amount (optional)
          job_no: Joi.string().optional().allow("", null), // Job number (optional)
          dept_code: Joi.string().optional().allow("", null), // Department code (optional)
          lcur_amount: Joi.number().optional().allow("", null), // Local currency amount (optional)
          tx_compnt_lcuramt_1: Joi.number().optional().allow("", null), // Transaction component 1 local currency amount (optional)
          tx_cat_code: Joi.string().optional().allow("", null), // Transaction category code (optional)
          div_code: Joi.string().required(), // Division code (required)
          doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).required().custom((v, h) => v == null ? v : String(v)), // Document number (required)
          doc_type: Joi.string() // Document type (required)
            .valid(
              constants.TRANSACTION_DOCUMENT_TYPE.SALES,
              constants.TRANSACTION_DOCUMENT_TYPE.SERVICE_INVOICE// Cheque payment
            )
            .required(),
          serial_no: Joi.number().required(), // Serial number (required)
        })
      )
      .min(1) // Minimum 1 detail item
      .required() // Detail is required
      .custom((value, helper) => {
        // Ensure 'doc_type' in 'detail' matches the root 'doc_type' and validate CR-specific constraints
        const rootDocType = helper.state.ancestors[0].doc_type;
        for (const item of value) {
          if (item.doc_type !== rootDocType) {
            throw new Error("doc_type in detail must match root doc_type");
          }
          // If root is Cash Receipt (CR), disallow cheque/bank fields at detail level
          if (
            rootDocType === constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT &&
            (item.cheque_no || item.cheque_date || item.cheque_bank || item.bank_ac_code)
          ) {
            throw new Error("Cheque/bank fields are not allowed for Cash Receipt in detail lines");
          }
        }
        return value;
      }),
    children: Joi.object({
      // Invoice details
      invoice: Joi.array()
        .items(
          Joi.object({
            // Document date
            doc_date: Joi.date(),
            // Account code (required)
            ac_code: Joi.string().required(),
            // Is deletable (optional, default false)
            IsDeletable: Joi.boolean().optional().default(false),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.number().allow(null, ""),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number()
              .integer()
              .valid(-1)
              .valid(1, -1)
              .required(),

            // Invoice number (optional)
            inv_no: Joi.string().allow("", null).allow("", null),
            // Invoice date (optional)
            inv_date: Joi.date().allow(null).optional(),
            // Invoice amount (optional)
            inv_amt: Joi.number().allow(null).optional(),
            // Current balance amount (optional)
            c_bal_amt_org: Joi.number().allow(null).optional(),
            // Amount (optional, default 0)
            amount: Joi.number().default(0).optional(),
            // Local currency amount (optional, default 0)
            lcur_amount: Joi.number().default(0).optional(),
            // Currency code (optional)
            curr_code: Joi.string().allow(null).optional(),
            // Exchange rate (optional)
            ex_rate: Joi.number().allow(null).optional(),
            // Current currency amount (optional)
            c_curr_amt: Joi.number().allow(null).optional(),
            amount_origin: Joi.number().default(0).optional(),
            indicator_origin: Joi.string().default('Y')
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'invoice' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in invoice must match root doc_type");
            }
          }
          return value;
        }),

      // Job details
      job: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.number().allow(null, ""),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Job number (optional)
            job_no: Joi.string().allow("", null).optional(),
            // Document reference number (optional)
            doc_refno: Joi.string().allow("", null).optional(),
            // Document reference number 2 (optional)
            doc_refno_2: Joi.string().allow("", null).optional(),
            // Amount (optional)
            amount: Joi.number().allow(null).optional(),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'job' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in job must match root doc_type");
            }
          }
          return value;
        }),

      // Expense details
      expense: Joi.array()
        .items(
          Joi.object({
            // Account code (required)
            ac_code: Joi.string().required(),
            // Serial number (required)
            serial_no: Joi.number().required(),
            // Detail serial number (required)
            dtl_sr_no: Joi.number().required(),
            // Document number (optional)
            doc_no: Joi.number().allow(null, ""),
            // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
            doc_type: Joi.string()
              .valid(
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
                constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
                constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
              )
              .required(),
            // Division code (required)
            div_code: Joi.string().required(),
            // Document date (required)
            doc_date: Joi.date().required(),
            // Company code (required)
            company_code: Joi.string().required(),
            // Sign indicator (optional)
            sign_ind: Joi.number().valid(-1, 1).allow(null),
            // Expense type code (required)
            exp_type_code: Joi.string().required(),
            // Expense subtype code (optional)
            exp_subtype_code: Joi.string().optional().allow("", null),
            // Expense subtype description (optional)
            exp_subtype_description: Joi.string().optional().allow("", null),
            // Expense code (optional)
            exp_code: Joi.string().optional().allow("", null),
            // Expense description (optional)
            exp_description: Joi.string().optional().allow("", null),
            // Job number (optional)
            job_no: Joi.string().optional().allow("", null),
            // Amount (required)
            amount: Joi.number(),
          })
        )
        .optional()
        .custom((value, helper) => {
          // Ensure 'doc_type' in 'expense' matches the root 'doc_type'
          for (const item of value) {
            if (
              item.doc_type !==
              helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
            ) {
              throw new Error("doc_type in expense must match root doc_type");
            }
          }
          return value;
        }),
    }).optional(),
  });// Define the Joi schema for the cheque payment document
  const schema = Joi.array().items(baseSchema);
  // Validate the data using the schema, depending on whether it's a bulk operation
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
};

export const LpoSchema = (
  data: any,
  userCompany?: string,
  isBulkOperation?: boolean
) => {
  const baseSchema = Joi.object({
    // Define the Joi schema for the cheque payment document
    // doc_no: Joi.number().optional().allow("", null), // Document number (optional)
    doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow("", null).custom((v, h) => v == null ? v : String(v)),
    doc_type: Joi.string() // Document type (required)
      .valid(
        constants.TRANSACTION_DOCUMENT_TYPE.LPO, // Cheque payment
      )
      .required(),
    ref_no: Joi.string().optional().allow("", null),
    party_name: Joi.string().required(), // Party name (required)
    ref_date: Joi.date().optional().allow("", null), // Otherwise cheque date is optional
    ac_code: Joi.string().required(), // Account code (required)
    ac_name: Joi.string().required(),
    doc_date: Joi.date(), // Document date
    product_code: Joi.string().optional().allow("", null),
    curr_name: Joi.string().optional().allow("", null),
    remarks: Joi.string().optional().allow("", null), // Remarks (optional)
    cost_code: Joi.string().optional().allow("", null),
    price: Joi.number().default(1), // Price (default 1)
    qty: Joi.number().default(1), // Quantity (default 1)
    ex_rate: Joi.number().default(1), // Exchange rate (default 1)
    curr_code: Joi.string().required(), // Currency code (required)
    address: Joi.string().optional().allow("", null),
    phone: Joi.string().optional().allow("", null),
    contact: Joi.string().optional().allow("", null),
    email: Joi.string().optional().allow('', null),
    party_address: Joi.string().optional().allow('', null),
    party_phone: Joi.string().optional().allow("", null),
    dlvr_contact: Joi.string().optional().allow("", null),
    dlvr_email: Joi.string().optional().allow('', null),
    dlvr_mobile: Joi.string().optional().allow("", null),
    app_ref_no: Joi.string().optional().allow('', null),
    delivary_term: Joi.string().optional().allow("", null),
    dlvr_term: Joi.string().optional().allow("", null),
    payment_terms: Joi.string().optional().allow("", null),
    delivary_info: Joi.string().optional().allow('', null),
    delivery_to: Joi.string().optional().allow('', null),
    fax: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow('', null),
    party_fax: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow('', null),
    // LPO PDO type (optional) - matches frontend select options
    pdo_type: Joi.string().optional().allow('', null).valid('PDO-OTO', 'PDO-NON-OTO', 'NON-PDO'),
    // Payment/delivery/terms (accept frontend spelling variants)
    terms: Joi.string().optional().allow("", null),
    delivery_info: Joi.string().optional().allow('', null),
    //delivary_term: Joi.string(),
    tax_cat_code: Joi.string().optional().allow("", null),
    tx_compntcat_code_1: Joi.string().optional().allow("", null),
    tx_compnt_1_expmt: Joi.string().optional().allow("", null),
    tx_compnt_perc_1: Joi.number().optional().allow("", null),
    tx_compnt_amt_1: Joi.number().optional().allow("", null),
    tax_categoty: Joi.number().optional(),
    tax_code: Joi.number().optional().allow("", null),
    tax_type: Joi.string().optional().allow("", null),
    tx_cat_code: Joi.string().optional().allow("", null),
    lpo_category: Joi.string().optional().allow("", null),
    // pdo_type: Joi.string().optional().allow("", null),
    inv_date: Joi.date().optional().allow("", null),
    invoice_date: Joi.date().optional().allow("", null),
    div_code: Joi.string().required(), // Division code (required)
    div_name: Joi.string().optional().allow('', null),
    warranty: Joi.string().optional().allow('', null),
    ref_doc_no: Joi.string().optional().allow("", null),
    mobile: Joi.string().optional().allow("", null),
    delivery_term: Joi.string().optional().allow("", null),
    company_code: Joi.string().optional().allow("", null),
    hse_compliance: Joi.string().optional().allow('', null),
    print_letter_head: Joi.boolean().optional().default(false),
    invoice_no: Joi.string().optional().allow('', null),
    canceled: Joi.string().optional().allow('', null),
    ...(isBulkOperation && { company_code: userCompany }),
    files: Joi.array()
      .items(
        Joi.object({
          file_name: Joi.string().allow("", null),
          file_path: Joi.string().allow("", null),
        })
      )
      .optional(),
    detail: Joi.array() // Detail (required)
      .items(
        Joi.object({
          sign_code:Joi.string().optional().allow("", null),
          doc_date: Joi.date(), // Document date
          company_code: Joi.string().required(), // Company code (required)
          prod_code: Joi.string().optional().allow("", null),
          ac_code: Joi.string().required(), // Account code (required)
          ac_name: Joi.string(),
          header_ac_code: Joi.string(),
          product_code: Joi.string().optional().allow("", null),
          description: Joi.string().optional().allow("", null),
          l4_description: Joi.string().optional().allow("", null),
          remarks: Joi.string().optional().allow("", null), // Remarks (optional)
          other_remarks: Joi.string().optional().allow("", null),
          cost_code: Joi.string().optional().allow("", null),
          price: Joi.number().default(1), // Price (default 1)
          qty: Joi.number().default(1), // Quantity (default 1) 
          qty_pending: Joi.number().optional().allow("", null),
          original_qty: Joi.number().optional().allow("", null),
          curr_code: Joi.string().required(), // Currency code (required)
          ex_rate: Joi.number(), // Exchange rate
          amount: Joi.number().required(), // Amount (required)
          project: Joi.string(), // Amount (required)
          sign_ind: Joi.number().valid(1,-1).allow(null), // Sign indicator (optional)
          tx_compntcat_code_1: Joi.string().optional().allow("", null), // Transaction component category code 1 (optional)
          tx_compnt_1_expmt: Joi.string().optional().allow("", null), // Transaction component 1 expense (optional)
          tx_compnt_perc_1: Joi.number().optional().allow("", null), // Transaction component 1 percentage (optional)
          tx_compnt_amt_1: Joi.number().optional().allow("", null), // Transaction component 1 amount (optional)
          job_no: Joi.string().optional().allow("", null), // Job number (optional)
          dept_code: Joi.string().optional().allow("", null), // Department code (optional)
          lcur_amount: Joi.number().optional().allow("", null), // Local currency amount (optional)
          tx_compnt_lcuramt_1: Joi.number().optional().allow("", null), // Transaction component 1 local currency amount (optional)
          tx_cat_code: Joi.string().optional().allow("", null), // Transaction category code (optional)
          div_code: Joi.string().required(), // Division code (required)
          doc_no: Joi.alternatives().try(Joi.string(), Joi.number()).required().custom((v, h) => v == null ? v : String(v)), // Document number (required)
          doc_type: Joi.string() // Document type (required)
            .valid(
              constants.TRANSACTION_DOCUMENT_TYPE.LPO, // Cheque payment
            )
            .required(),
          serial_no: Joi.number().required(), // Serial number (required)
        })
      )
      .min(1) // Minimum 1 detail item
      .required() // Detail is required
      .custom((value, helper) => {
        // Ensure 'doc_type' in 'detail' matches the root 'doc_type' and validate CR-specific constraints
        const rootDocType = helper.state.ancestors[0].doc_type;
        for (const item of value) {
          if (item.doc_type !== rootDocType) {
            throw new Error("doc_type in detail must match root doc_type");
          }
          // If root is Cash Receipt (CR), disallow cheque/bank fields at detail level
          if (
            rootDocType === constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT &&
            (item.cheque_no || item.cheque_date || item.cheque_bank || item.bank_ac_code)
          ) {
            throw new Error("Cheque/bank fields are not allowed for Cash Receipt in detail lines");
          }
        }
        return value;
      }),
    //    children: Joi.object({
    //   // Invoice details
    //   invoice: Joi.array()
    //     .items(
    //       Joi.object({
    //         // Document date
    //         doc_date: Joi.date(),
    //         // Account code (required)
    //         ac_code: Joi.string().required(),
    //         // Is deletable (optional, default false)
    //         IsDeletable: Joi.boolean().optional().default(false),
    //         // Serial number (required)
    //         serial_no: Joi.number().required(),
    //         // Detail serial number (required)
    //         dtl_sr_no: Joi.number().required(),
    //         // Document number (optional)
    //         doc_no: Joi.number().allow(null, ""),
    //         // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
    //         doc_type: Joi.string()
    //           .valid(
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
    //           )
    //           .required(),
    //         // Division code (required)
    //         div_code: Joi.string().required(),
    //         // Company code (required)
    //         company_code: Joi.string().required(),
    //         // Sign indicator (optional)
    //         sign_ind: Joi.number()
    //           .integer()
    //           .valid(-1)
    //           .required(),

    //         // Invoice number (optional)
    //         inv_no: Joi.string().allow("", null).allow("", null),
    //         // Invoice date (optional)
    //         inv_date: Joi.date().allow(null).optional(),
    //         // Invoice amount (optional)
    //         inv_amt: Joi.number().allow(null).optional(),
    //         // Current balance amount (optional)
    //         c_bal_amt_org: Joi.number().allow(null).optional(),
    //         // Amount (optional, default 0)
    //         amount: Joi.number().default(0).optional(),
    //         // Currency code (optional)
    //         curr_code: Joi.string().allow(null).optional(),
    //         // Exchange rate (optional)
    //         ex_rate: Joi.number().allow(null).optional(),
    //         // Current currency amount (optional)
    //         c_curr_amt: Joi.number().allow(null).optional(),
    //         amount_origin: Joi.number().default(0).optional(),
    //       })
    //     )
    //     .optional()
    //     .custom((value, helper) => {
    //       // Ensure 'doc_type' in 'invoice' matches the root 'doc_type'
    //       for (const item of value) {
    //         if (
    //           item.doc_type !==
    //           helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
    //         ) {
    //           throw new Error("doc_type in invoice must match root doc_type");
    //         }
    //       }
    //       return value;
    //     }),

    //   // Job details
    //   job: Joi.array()
    //     .items(
    //       Joi.object({
    //         // Account code (required)
    //         ac_code: Joi.string().required(),
    //         // Serial number (required)
    //         serial_no: Joi.number().required(),
    //         // Detail serial number (required)
    //         dtl_sr_no: Joi.number().required(),
    //         // Document number (optional)
    //         doc_no: Joi.number().allow(null, ""),
    //         // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
    //         doc_type: Joi.string()
    //           .valid(
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
    //           )
    //           .required(),
    //         // Division code (required)
    //         div_code: Joi.string().required(),
    //         // Document date (required)
    //         doc_date: Joi.date().required(),
    //         // Company code (required)
    //         company_code: Joi.string().required(),
    //         // Sign indicator (optional)
    //         sign_ind: Joi.number().valid(-1, 1).allow(null),
    //         // Job number (optional)
    //         job_no: Joi.string().allow("", null).optional(),
    //         // Document reference number (optional)
    //         doc_refno: Joi.string().allow("", null).optional(),
    //         // Document reference number 2 (optional)
    //         doc_refno_2: Joi.string().allow("", null).optional(),
    //         // Amount (optional)
    //         amount: Joi.number().allow(null).optional(),
    //       })
    //     )
    //     .optional()
    //     .custom((value, helper) => {
    //       // Ensure 'doc_type' in 'job' matches the root 'doc_type'
    //       for (const item of value) {
    //         if (
    //           item.doc_type !==
    //           helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
    //         ) {
    //           throw new Error("doc_type in job must match root doc_type");
    //         }
    //       }
    //       return value;
    //     }),

    //   // Expense details
    //   expense: Joi.array()
    //     .items(
    //       Joi.object({
    //         // Account code (required)
    //         ac_code: Joi.string().required(),
    //         // Serial number (required)
    //         serial_no: Joi.number().required(),
    //         // Detail serial number (required)
    //         dtl_sr_no: Joi.number().required(),
    //         // Document number (optional)
    //         doc_no: Joi.number().allow(null, ""),
    //         // Document type (required, valid values: CHEQUE_PAYMENT, CHEQUE_RECEIPT, CASH_RECEIPT)
    //         doc_type: Joi.string()
    //           .valid(
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_PAYMENT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CHEQUE_RECEIPT,
    //             constants.TRANSACTION_DOCUMENT_TYPE.CASH_RECEIPT
    //           )
    //           .required(),
    //         // Division code (required)
    //         div_code: Joi.string().required(),
    //         // Document date (required)
    //         doc_date: Joi.date().required(),
    //         // Company code (required)
    //         company_code: Joi.string().required(),
    //         // Sign indicator (optional)
    //         sign_ind: Joi.number().valid(-1, 1).allow(null),
    //         // Expense type code (required)
    //         exp_type_code: Joi.string().required(),
    //         // Expense subtype code (optional)
    //         exp_subtype_code: Joi.string().optional().allow("", null),
    //         // Expense subtype description (optional)
    //         exp_subtype_description: Joi.string().optional().allow("", null),
    //         // Expense code (optional)
    //         exp_code: Joi.string().optional().allow("", null),
    //         // Expense description (optional)
    //         exp_description: Joi.string().optional().allow("", null),
    //         // Job number (optional)
    //         job_no: Joi.string().optional().allow("", null),
    //         // Amount (required)
    //         amount: Joi.number(),
    //       })
    //     )
    //     .optional()
    //     .custom((value, helper) => {
    //       // Ensure 'doc_type' in 'expense' matches the root 'doc_type'
    //       for (const item of value) {
    //         if (
    //           item.doc_type !==
    //           helper.state.ancestors[helper.state.ancestors.length - 1].doc_type
    //         ) {
    //           throw new Error("doc_type in expense must match root doc_type");
    //         }
    //       }
    //       return value;
    //     }),
    // }).optional(),

  });// Define the Joi schema for the cheque payment document
  const schema = Joi.array().items(baseSchema);
  // Validate the data using the schema, depending on whether it's a bulk operation
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
};

export const pettyCashSchema = (
  data: any,
  userCompany?: string,
  isBulkOperation?: boolean
) => {
  const baseSchema = Joi.object({
    doc_no: Joi.number().optional().allow("", null),
    doc_type: Joi.string()
      .valid(
        constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT, // Petty cash payment
      ).required(),
    ac_code: Joi.string().required(),
    ac_name: Joi.string().required(),
    doc_date: Joi.date().optional(),
    curr_code: Joi.string().required(),
    ac_payee: Joi.string().required(),
    ex_rate: Joi.number().default(1),
    remarks: Joi.string().optional().allow("", null),
    div_code: Joi.string().required(), // Division code (required)

    detail: Joi.array() // Detail (required)
      .items(
        Joi.object({
          div_code: Joi.string().required(), // Division code (required)
          company_code: Joi.string().required(), // Company code (required)
          ac_code: Joi.string().required(),
          ac_name: Joi.string(),
          remarks: Joi.string().optional().allow("", null),
          curr_code: Joi.string().required(),
          ex_rate: Joi.number().default(1),
          price: Joi.number().default(1),
          qty: Joi.number().default(1),
          amount: Joi.number().required(),
          sign_ind: Joi.number().valid(1).allow(null), // Sign indicator (1)
          tx_compntcat_code_1: Joi.string().allow(null, ""), // Transaction component category code 1 (optional)
          tx_compnt_1_expmt: Joi.string().optional().allow("", null), // Transaction component 1 expense (optional)
          tx_compnt_perc_1: Joi.number().allow(null), // Transaction component 1 percentage (optional)
          tx_compnt_amt_1: Joi.number().allow(null), // Transaction component 1 amount (optional)
          job_no: Joi.string().optional().allow("", null), // Job number (optional)
          dept_code: Joi.string().allow("", null), // Department code (optional)
          lcur_amount: Joi.number().allow("", null), // Local currency amount (optional)
          tx_compnt_lcuramt_1: Joi.number().allow("", null), // Transaction component 1 local currency amount (optional)
          tx_cat_code: Joi.string().allow("", null), // Transaction category code (optional)
          doc_no: Joi.number().required(), // Document number (required)
          doc_type: Joi.string() // Document type (required)
            .valid(
              constants.TRANSACTION_DOCUMENT_TYPE.PETTY_CASH_PAYMENT, // Petty cash payment
            )
            .required(),
          serial_no: Joi.number().required(),
        })
      )

  })
  const schema = Joi.array().items(baseSchema);
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
}