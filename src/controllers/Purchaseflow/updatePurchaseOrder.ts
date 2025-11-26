import oracledb from "oracledb";
import { Request, Response } from "express";

export const updatePurchaseOrder = async (req: Request, res: Response): Promise<void> => {
  const requestUser = req.user as any; // Adjust IUser type
  const {
    last_action,
    items,
    ref_doc_no,
  } = req.body;

  let connection;

  try {
    connection = await oracledb.getConnection();

    // Start transaction
    await connection.execute("BEGIN NULL; END;");
    await connection.execute("SAVEPOINT start_transaction");

    // -----------------------
    // PO Modification
    // -----------------------
    if (last_action === "Pomodify" && Array.isArray(items)) {
      for (const item of items) {
        await connection.execute(
          `UPDATE PURCHASE_REQUEST_DETAILS
           SET po_mod_final_rate = :po_mod_final_rate,
               po_mod_amount = :po_mod_amount,
               po_confirm = 'N',
               po_cancel = 'N'
           WHERE company_code = :company_code
             AND ref_doc_no = :ref_doc_no
             AND item_code = :item_code
             AND final_rate = :final_rate
             AND allocated_approved_quantity = :allocated_approved_quantity
             AND item_p_qty = :item_p_qty
             AND item_l_qty = :item_l_qty
             AND addl_item_desc = :addl_item_desc`,
          {
            po_mod_final_rate: item.po_mod_final_rate,
            po_mod_amount: item.po_mod_amount,
            company_code: requestUser.company_code,
            ref_doc_no: item.ref_doc_no,
            item_code: item.item_code,
            final_rate: item.final_rate,
            allocated_approved_quantity: item.allocated_approved_quantity,
            item_p_qty: item.item_p_qty,
            item_l_qty: item.item_l_qty,
            addl_item_desc: item.addl_item_desc,
          }
        );
      }

      await connection.commit();
      res.status(200).json({ message: "PO modification successful." });
      return;
    }

    // -----------------------
    // PO Confirmation
    // -----------------------
    if (last_action === "Confirm") {
      // Update PURCHASE_REQUEST_DETAILS
      await connection.execute(
        `UPDATE PURCHASE_REQUEST_DETAILS
         SET history_serial = 0,
             po_confirm = 'Y',
             po_cancel = 'N',
             po_date = SYSDATE
         WHERE ref_doc_no = :ref_doc_no
           AND company_code = :company_code`,
        { ref_doc_no, company_code: requestUser.company_code }
      );

      // Update PO_DETAILS for revision number
      await connection.execute(
        `UPDATE PO_DETAILS
         SET revision_number = dumm_revision_number
         WHERE ref_doc_no = :ref_doc_no
           AND company_code = :company_code
           AND revision_number IS NULL`,
        { ref_doc_no, company_code: requestUser.company_code }
      );

      await connection.commit();

      res.status(200).json({ message: "Purchase order confirmed successfully." });
      return;
    }

    res.status(400).json({ message: "Invalid last_action value." });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Error rolling back transaction:", rollbackErr);
      }
    }
    res.status(500).json({ message: "Failed to process purchase order.", error });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing Oracle connection:", closeErr);
      }
    }
  }
};
