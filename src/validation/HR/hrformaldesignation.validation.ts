import Joi from "joi";
import { IHrLabourDesignation } from "../../interfaces/Hr/hr_labour_designation";

export const formaldesignationSchema = (
  data: IHrLabourDesignation,
  userCompany: string,
  isBulkOperation: boolean
) => {
  const baseSchema = Joi.object().keys({
    company_code: Joi.string().valid(userCompany).required(),
    labour_desg_code: Joi.string().required(),
    labour_desg_name: Joi.string().required(),
    labour_desg_short_name: Joi.string().allow("", null).optional(),
    remarks: Joi.string().allow("", null).optional(),
    status: Joi.string().allow("", null).optional(),
    
    // Added these fields so Joi doesn't reject them:
    user_id: Joi.string().allow("", null).optional(),
    user_dt: Joi.string().allow("", null).optional(),
    loginid: Joi.string().allow("", null).optional(),
  }).unknown(true);
  
  const schema = Joi.array().items(baseSchema);
  
  // Use abortEarly: false so it returns all validation errors at once instead of just the first one
  const options = { abortEarly: false };
  
  return isBulkOperation ? schema.validate(data, options) : baseSchema.validate(data, options);
};