import supabase from "../config/supabaseClient.js";

class ModerationService {
  async listReports({ status = null } = {}) {
    let query = supabase
      .from("social_reports")
      .select(`
        id,
        reporter_id,
        reported_user_id,
        target_type,
        target_id,
        reason,
        description,
        status,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at,
        reporter:reporter_id (
          id_usuario,
          nombre,
          correo
        ),
        reported:reported_user_id (
          id_usuario,
          nombre,
          correo,
          is_suspended
        )
      `)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return data || [];
  }

  async updateReportStatus({ report_id, status, reviewed_by }) {
    const allowed = ["pending", "reviewed", "blocked", "dismissed", "rehabilitated"];

    if (!allowed.includes(status)) {
      throw new Error("Estado de reporte inválido");
    }

    const { data: report, error: reportError } = await supabase
      .from("social_reports")
      .select("id, reported_user_id")
      .eq("id", report_id)
      .maybeSingle();

    if (reportError) throw new Error(reportError.message);
    if (!report) throw new Error("Reporte no encontrado");

    if (status === "blocked" && report.reported_user_id) {
      const { error: suspendError } = await supabase
        .from("usuarios")
        .update({ is_suspended: true })
        .eq("id_usuario", report.reported_user_id);

      if (suspendError) throw new Error(suspendError.message);
    }

    if (status === "rehabilitated" && report.reported_user_id) {
        const { error: rehabilitateError } = await supabase
            .from("usuarios")
            .update({ is_suspended: false })
            .eq("id_usuario", report.reported_user_id);

        if (rehabilitateError) throw new Error(rehabilitateError.message);
    }

    const { data, error } = await supabase
      .from("social_reports")
      .update({
        status,
        reviewed_by,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", report_id)
      .select(`
        id,
        reporter_id,
        reported_user_id,
        target_type,
        target_id,
        reason,
        description,
        status,
        reviewed_by,
        reviewed_at,
        created_at,
        updated_at
      `)
      .single();

    if (error) throw new Error(error.message);

    return data;
  }

  async getPendingCount() {
    const { count, error } = await supabase
        .from("social_reports")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");

    if (error) throw new Error(error.message);

    return count || 0;
    }


  async getPendingCount() {
    const { count, error } = await supabase
      .from("social_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

       if (error) throw new Error(error.message);

       return count || 0;
}
}



export default new ModerationService();