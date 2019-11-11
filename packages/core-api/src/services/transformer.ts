import { Container, Contracts } from "@arkecosystem/core-kernel";

import { transformBlock } from "../handlers/blocks/transformer";
import { transformBridgechain } from "../handlers/bridgechains/transformer";
import { transformBusiness } from "../handlers/businesses/transformer";
import { transformDelegate } from "../handlers/delegates/transformer";
import { transformLock } from "../handlers/locks/transformer";
import { transformPeer } from "../handlers/peers/transformer";
import { transformRoundDelegate } from "../handlers/rounds/transformer";
import { transformFeeStatistics } from "../handlers/shared/transformers/fee-statistics";
import { transformPorts } from "../handlers/shared/transformers/ports";
import { transformTransaction } from "../handlers/transactions/transformer";
import { transformWallet } from "../handlers/wallets/transformer";

@Container.injectable()
export class TransformerService {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    private readonly transformers: Record<string, any> = {
        block: transformBlock,
        bridgechain: transformBridgechain,
        business: transformBusiness,
        delegate: transformDelegate,
        "fee-statistics": transformFeeStatistics,
        peer: transformPeer,
        ports: transformPorts,
        "round-delegate": transformRoundDelegate,
        transaction: transformTransaction,
        wallet: transformWallet,
        lock: transformLock,
    };

    public toResource(data, transformer, transform = true): object {
        return this.transformers[transformer](this.app, data, transform);
    }

    public toCollection(data, transformer, transform = true): object[] {
        return data.map(d => this.toResource(d, transformer, transform));
    }
}
