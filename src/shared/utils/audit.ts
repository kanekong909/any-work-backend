import { AppDataSource } from '../../config/data-source';
import { AuditLog, AuditAction } from '../../modules/audit/audit-log.entity';

export async function logAction(params: {
  tenantId: string;
  userId: string | null;
  userName: string;
  action: AuditAction;
  module: string;
  description: string;
}) {
  try {
    const logRepo = AppDataSource.getRepository(AuditLog);
    const log = logRepo.create(params);
    await logRepo.save(log);
  } catch (error) {
    console.error('Error guardando el log de auditoría:', error);
  }
}
