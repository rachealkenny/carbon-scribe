import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import * as StellarSdk from '@stellar/stellar-sdk';

@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);
  private readonly rpc: StellarSdk.rpc.Server;

  constructor(private readonly configService: ConfigService) {
    const stellarConfig = this.configService.getStellarConfig();
    // Assuming a Soroban RPC URL is available in config
    this.rpc = new StellarSdk.rpc.Server(
      stellarConfig.sorobanRpcUrl || 'https://soroban-testnet.stellar.org',
    );
  }

  /**
   * Fetches events for a specific contract from a given start ledger
   */
  async getContractEvents(
    contractId: string,
    startLedger: number,
  ): Promise<any[]> {
    try {
      const safeStartLedger = Number.isFinite(startLedger)
        ? Math.max(1, Math.floor(startLedger))
        : 1;

      this.logger.debug(
        `Fetching events for contract ${contractId} from ledger ${safeStartLedger}`,
      );

      const response = await this.rpc.getEvents({
        startLedger: safeStartLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
          },
        ],
      });
      return response.events || [];
    } catch (error) {
      const message = this.getErrorMessage(error);
      const rangeMatch = message.match(/ledger range:\s*(\d+)\s*-\s*(\d+)/i);

      if (rangeMatch) {
        const rangeStart = Number.parseInt(rangeMatch[1], 10);
        if (Number.isFinite(rangeStart) && rangeStart > 0) {
          return this.retryFromLedger(contractId, rangeStart);
        }
      }

      // If RPC error payload is opaque, fall back to a recent window from the latest ledger.
      try {
        const latest = await this.rpc.getLatestLedger();
        const latestSequence = this.toLedgerNumber(latest);
        if (latestSequence > 0) {
          const fallbackStart = Math.max(1, latestSequence - 1000);
          this.logger.warn(
            `Unable to parse range hint from Soroban error; retrying from recent ledger window starting at ${fallbackStart}.`,
          );
          return this.retryFromLedger(contractId, fallbackStart);
        }
      } catch {
        // Ignore latest-ledger fetch failures; we log original error below.
      }

      this.logger.error(`Failed to fetch Soroban events: ${message}`);
      return [];
    }
  }

  private async retryFromLedger(
    contractId: string,
    startLedger: number,
  ): Promise<any[]> {
    this.logger.warn(
      `Adjusting Soroban start ledger to ${startLedger} based on RPC hints.`,
    );
    try {
      const retryResponse = await this.rpc.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
          },
        ],
      });
      return retryResponse.events || [];
    } catch (retryError) {
      this.logger.error(
        `Failed to fetch Soroban events after range adjustment: ${this.getErrorMessage(retryError)}`,
      );
      return [];
    }
  }

  private toLedgerNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value);
    }

    if (typeof value === 'object' && value !== null) {
      const candidate = (value as Record<string, unknown>).sequence;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.floor(candidate);
      }
      if (typeof candidate === 'string') {
        const parsed = Number.parseInt(candidate, 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return 0;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  /**
   * Returns the sequence number of the most recent ledger known to the Soroban RPC.
   * Returns 0 if the call fails.
   */
  async getLatestLedgerSequence(): Promise<number> {
    try {
      const latest = await this.rpc.getLatestLedger();
      return this.toLedgerNumber(latest);
    } catch (error) {
      this.logger.warn(
        `Could not fetch latest ledger from Soroban RPC: ${this.getErrorMessage(error)}`,
      );
      return 0;
    }
  }

  /**
   * Decodes ScVal from XDR into native Javascript types
   */
  decodeScVal(scVal: any): any {
    try {
      // In @stellar/stellar-sdk, scVal is often already decoded or provided as XDR
      // We use StellarSdk.scValToNative for the conversion
      return StellarSdk.scValToNative(scVal);
    } catch (error) {
      this.logger.warn(`Failed to decode ScVal: ${error.message}`);
      return scVal;
    }
  }
}
