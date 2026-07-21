CREATE OR REPLACE PROCEDURE PROC_FRT_RFQ_LIST (
  p_company_code IN VARCHAR2,
  p_search       IN VARCHAR2 DEFAULT NULL,
  p_from_date    IN DATE DEFAULT NULL,
  p_to_date      IN DATE DEFAULT NULL,
  p_result       OUT SYS_REFCURSOR
) AS
BEGIN
  PROC_FRT_ENQUIRY_LIST(
    p_company_code => p_company_code,
    p_enquiry_type => 'RFQ',
    p_search => p_search,
    p_from_date => p_from_date,
    p_to_date => p_to_date,
    p_result => p_result
  );
END;
/

CREATE OR REPLACE PROCEDURE PROC_FRT_RFQ_GET (
  p_company_code IN VARCHAR2,
  p_rfq_nr       IN VARCHAR2,
  p_header       OUT SYS_REFCURSOR,
  p_details      OUT SYS_REFCURSOR
) AS
BEGIN
  PROC_FRT_ENQUIRY_GET(
    p_company_code => p_company_code,
    p_enquiry_type => 'RFQ',
    p_enquiry_nr => p_rfq_nr,
    p_header => p_header,
    p_details => p_details
  );
END;
/

CREATE OR REPLACE PROCEDURE PROC_FRT_RFQ_SAVE (
  p_header     IN FRT_ENQUIRY_HDR_TAB,
  p_details    IN FRT_ENQUIRY_DET_TAB,
  p_rfq_nr_out OUT VARCHAR2
) AS
  v_ref_type VARCHAR2(20);
  v_ref_nr   VARCHAR2(50);
  v_company  VARCHAR2(20);
  v_count    NUMBER;
  v_header   FRT_ENQUIRY_HDR_TAB;
BEGIN
  IF p_header IS NULL OR p_header.COUNT = 0 THEN
    RAISE_APPLICATION_ERROR(-20201, 'RFQ header is required');
  END IF;

  v_header := p_header;
  v_header(1).enquiry_type := 'RFQ';
  v_ref_type := v_header(1).ref_enquiry_type;
  v_ref_nr := v_header(1).ref_enquiry_nr;
  v_company := v_header(1).company_code;

  PROC_FRT_ENQUIRY_SAVE(v_header, p_details, p_rfq_nr_out);

  SELECT COUNT(*)
    INTO v_count
    FROM tf_enquiry_det
   WHERE company_code = v_company
     AND enquiry_type = 'RFQ'
     AND enquiry_nr = p_rfq_nr_out;

  IF v_count = 0 AND v_ref_nr IS NOT NULL THEN
    INSERT INTO tf_enquiry_det (
      company_code, prin_code, enquiry_nr, act_code, quantity, uom,
      bill_rate, cost_rate, bill, cost, userid, user_dt,
      curr_code, ex_rate, uoc, moc1, moc2, partners_price,
      fc_cost, fc_bill, fc_partners, fc_costrate, fc_billrate,
      origin_port, destination_port, sr_no, transport_mode, srno,
      cost_curr_code, cost_ex_rate, partners_curr_code, partners_ex_rate,
      enquiry_type, remarks
    )
    SELECT
      company_code, prin_code, p_rfq_nr_out, act_code, quantity, uom,
      bill_rate, cost_rate, bill, cost, userid, SYSDATE,
      curr_code, ex_rate, uoc, moc1, moc2, partners_price,
      fc_cost, fc_bill, fc_partners, fc_costrate, fc_billrate,
      origin_port, destination_port, sr_no, transport_mode, srno,
      cost_curr_code, cost_ex_rate, partners_curr_code, partners_ex_rate,
      'RFQ', remarks
    FROM tf_enquiry_det
    WHERE company_code = v_company
      AND enquiry_type = NVL(v_ref_type, 'EQI')
      AND enquiry_nr = v_ref_nr;
  END IF;
END;
/

CREATE OR REPLACE PROCEDURE PROC_FRT_RFQ_DELETE (
  p_company_code IN VARCHAR2,
  p_rfq_nr       IN VARCHAR2
) AS
BEGIN
  PROC_FRT_ENQUIRY_DELETE(
    p_company_code => p_company_code,
    p_enquiry_type => 'RFQ',
    p_enquiry_nr => p_rfq_nr
  );
END;
/
