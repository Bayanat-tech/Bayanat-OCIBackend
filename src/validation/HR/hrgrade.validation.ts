import Joi from "joi";
import { IHrGrade } from "../../interfaces/Hr/hr_grade";

export const gradeSchema = (
  data: IHrGrade,
  userCompany: string,
  isBulkOperation: boolean
) => {
  const baseSchema = Joi.object().keys({
    company_code:          Joi.string().required(),
    grade_code:            Joi.string().allow("", null).optional(),
    grade_name:            Joi.string().required(),
    grade_short_name:      Joi.string().allow("", null).optional(),
    ot_eligibility:        Joi.string().allow("", null).optional(),
    grade_status:          Joi.string().allow("", null).optional(),
    status:                Joi.string().allow("", null).optional(),
    remarks:               Joi.string().allow("", null).optional(),
    airfare_entitlement:   Joi.string().allow("", null).optional(),
    spouse_af_entitlement: Joi.string().allow("", null).optional(),
    dep_af_entitlement:    Joi.string().allow("", null).optional(),
    medical_entitlement:   Joi.string().allow("", null).optional(),
    spouse_med_entitlement:Joi.string().allow("", null).optional(),
    dep_med_entitlement:   Joi.string().allow("", null).optional(),
    user_id:               Joi.string().allow("", null).optional(),
    user_dt:               Joi.string().allow("", null).optional(),
    type:                  Joi.string().allow("", null).optional(),
    main_grade_code:       Joi.string().allow("", null).optional(),
    def_grade_code:        Joi.string().allow("", null).optional(),
    // set by controller, not the DB column — allow so Joi doesn't reject them
    created_by:            Joi.string().allow("", null).optional(),
    updated_by:            Joi.string().allow("", null).optional(),
  });

  const schema = Joi.array().items(baseSchema);
  return isBulkOperation ? schema.validate(data) : baseSchema.validate(data);
};