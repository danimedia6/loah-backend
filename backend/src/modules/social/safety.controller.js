import safetyService from "./safety.service.js";

function getAuthUserId(req) {
  return req.user?.id_usuario || req.user?.id || req.userId || req.body.user_id;
}

class SafetyController {

  async listBlocks(req, res) {
    try {
      const user_id = getAuthUserId(req);

      const data = await safetyService.getBlocksByUser(user_id);

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async blockUser(req, res) {
    try {
      const blocker_id = getAuthUserId(req);
      const { blocked_id, reason, visibility_mode } = req.body;

      console.log("[safety block:req.body]", req.body);

      const data = await safetyService.blockUser({
        blocker_id,
        blocked_id,
        reason,
        visibility_mode,
      });

      return res.status(201).json({
        success: true,
        message: "Usuario bloqueado correctamente",
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async unblockUser(req, res) {
    try {
      const blocker_id = getAuthUserId(req);
      const { blocked_id } = req.params;

      const data = await safetyService.unblockUser({
        blocker_id,
        blocked_id,
      });

      return res.json({
        success: true,
        message: "Usuario desbloqueado correctamente",
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async reportProfile(req, res) {
    try {
      const reporter_id = getAuthUserId(req);
      const { reported_user_id, reason, description } = req.body;

      const data = await safetyService.reportProfile({
        reporter_id,
        reported_user_id,
        reason,
        description,
      });

      return res.status(201).json({
        success: true,
        message: "Perfil reportado correctamente",
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  async reportMessage(req, res) {
    try {
      const reporter_id = getAuthUserId(req);
      const { message_id, reason, description } = req.body;

      const data = await safetyService.reportMessage({
        reporter_id,
        message_id,
        reason,
        description,
      });

      return res.status(201).json({
        success: true,
        message: "Mensaje reportado correctamente",
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

export default new SafetyController();
