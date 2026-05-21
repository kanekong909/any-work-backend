import { AppDataSource } from '../../config/data-source';
import { StockMovement, MovementType, MovementReason } from './stock.movement';
import { Product } from './product.entity';
import { QueryRunner } from 'typeorm';

export interface CreateMovementDto {
  productId: string;
  movementType: MovementType;
  reason: MovementReason;
  quantity: number;
  tenantId: string;
  userId?: string;
  warehouseId?: string;
  unitCost?: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
  queryRunner?: QueryRunner;
}

export class StockMovementService {
  static async createMovement(dto: CreateMovementDto): Promise<StockMovement> {
    const queryRunner = dto.queryRunner || AppDataSource.createQueryRunner();
    const isExternalQueryRunner = !!dto.queryRunner;

    if (!isExternalQueryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }

    try {
      const productRepo = queryRunner.manager.getRepository(Product);
      const movementRepo = queryRunner.manager.getRepository(StockMovement);

      const product = await productRepo.findOne({
        where: { id: dto.productId, tenantId: dto.tenantId }
      });

      if (!product) {
        throw new Error(`Producto no encontrado: ${dto.productId}`);
      }

      const stockBefore = Number(product.stock);
      let stockAfter = stockBefore;

      if (dto.movementType === MovementType.IN) {
        stockAfter += Number(dto.quantity);
      } else if (dto.movementType === MovementType.OUT) {
        stockAfter -= Number(dto.quantity);
        if (stockAfter < 0) {
          throw new Error(`Stock insuficiente. Stock disponible: ${stockBefore}`);
        }
      } else if (dto.movementType === MovementType.ADJUSTMENT) {
        stockAfter = Number(dto.quantity);
      }

      await productRepo.update(
        { id: dto.productId },
        { stock: stockAfter }
      );

      const movement = movementRepo.create({
        productId: dto.productId,
        movementType: dto.movementType,
        reason: dto.reason,
        quantity: dto.quantity,
        stockBefore,
        stockAfter,
        unitCost: dto.unitCost,
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
        notes: dto.notes,
        userId: dto.userId,
        warehouseId: dto.warehouseId,
        tenantId: dto.tenantId,
        product,
      });

      const saved = await movementRepo.save(movement);

      if (!isExternalQueryRunner) {
        await queryRunner.commitTransaction();
      }

      return saved;
    } catch (error) {
      if (!isExternalQueryRunner) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!isExternalQueryRunner) {
        await queryRunner.release();
      }
    }
  }

  static async recordSaleMovement(
    productId: string,
    quantity: number,
    tenantId: string,
    userId?: string,
    warehouseId?: string,
    referenceId?: string,
    queryRunner?: QueryRunner
  ): Promise<StockMovement> {
    return this.createMovement({
      productId,
      movementType: MovementType.OUT,
      reason: MovementReason.SALE,
      quantity,
      tenantId,
      userId,
      warehouseId,
      referenceId,
      referenceType: 'SALE',
      queryRunner,
    });
  }

  static async recordPurchaseMovement(
    productId: string,
    quantity: number,
    tenantId: string,
    userId?: string,
    unitCost?: number,
    warehouseId?: string,
    referenceId?: string,
    queryRunner?: QueryRunner
  ): Promise<StockMovement> {
    return this.createMovement({
      productId,
      movementType: MovementType.IN,
      reason: MovementReason.PURCHASE,
      quantity,
      tenantId,
      userId,
      warehouseId,
      unitCost,
      referenceId,
      referenceType: 'PURCHASE',
      queryRunner,
    });
  }

  static async recordAdjustmentMovement(
    productId: string,
    quantity: number,
    tenantId: string,
    reason: MovementReason,
    userId?: string,
    warehouseId?: string,
    notes?: string,
    queryRunner?: QueryRunner
  ): Promise<StockMovement> {
    return this.createMovement({
      productId,
      movementType: MovementType.ADJUSTMENT,
      reason,
      quantity,
      tenantId,
      userId,
      warehouseId,
      notes,
      queryRunner,
    });
  }
}
