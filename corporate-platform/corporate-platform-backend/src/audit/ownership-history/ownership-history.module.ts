import { Module } from '@nestjs/common';
import { OwnershipHistoryService } from './ownership-history.service';
import { EventProcessorService } from './event-processor.service';
import { HistoryQueryService } from './history-query.service';
import { OwnershipHistoryController } from './ownership-history.controller';
import { PrismaModule } from '../../../shared/database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OwnershipHistoryController],
  providers: [
    OwnershipHistoryService,
    EventProcessorService,
    HistoryQueryService,
  ],
  exports: [
    OwnershipHistoryService,
    EventProcessorService,
    HistoryQueryService,
  ],
})
export class OwnershipHistoryModule {}
