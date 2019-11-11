import { Container, Contracts, Providers, Utils } from "@arkecosystem/core-kernel";
import { Crypto, Interfaces } from "@arkecosystem/crypto";

import { MissingCommonBlockError } from "../../errors";
import { PeerPingResponse } from "../../interfaces";
import { PeerService } from "../../types";
import { isWhitelisted } from "../../utils";
import { InvalidTransactionsError, UnchainedBlockError } from "../errors";
import { getPeerConfig } from "../utils/get-peer-config";
import { mapAddr } from "../utils/map-addr";

// todo: review the implementation of all methods

export const getPeers = ({ service }: { service: PeerService }): Contracts.P2P.PeerBroadcast[] => {
    return service.storage
        .getPeers()
        .map(peer => peer.toBroadcast())
        .sort((a, b) => {
            Utils.assert.defined<number>(a.latency);
            Utils.assert.defined<number>(b.latency);

            return a.latency - b.latency;
        });
};

export const getCommonBlocks = async ({
    app,
    req,
}: {
    app: Contracts.Kernel.Application;
    req: any;
}): Promise<{
    common: Interfaces.IBlockData;
    lastBlockHeight: number;
}> => {
    const blockchain: Contracts.Blockchain.Blockchain = app.get<Contracts.Blockchain.Blockchain>(
        Container.Identifiers.BlockchainService,
    );

    const database: Contracts.Database.DatabaseService = app.get<Contracts.Database.DatabaseService>(
        Container.Identifiers.DatabaseService,
    );

    const commonBlocks: Interfaces.IBlockData[] = await database.getCommonBlocks(req.data.ids);

    if (!commonBlocks.length) {
        throw new MissingCommonBlockError();
    }

    return {
        common: commonBlocks[0],
        lastBlockHeight: blockchain.getLastBlock().data.height,
    };
};

export const getStatus = async ({ app }: { app: Contracts.Kernel.Application }): Promise<PeerPingResponse> => {
    const lastBlock: Interfaces.IBlock = app
        .get<Contracts.Blockchain.Blockchain>(Container.Identifiers.BlockchainService)
        .getLastBlock();

    return {
        state: {
            height: lastBlock ? lastBlock.data.height : 0,
            forgingAllowed: Crypto.Slots.isForgingAllowed(),
            currentSlot: Crypto.Slots.getSlotNumber(),
            header: lastBlock ? lastBlock.getHeader() : {},
        },
        config: getPeerConfig(app),
    };
};

export const postBlock = async ({ app, req }: { app: Contracts.Kernel.Application; req: any }): Promise<void> => {
    const blockchain: Contracts.Blockchain.Blockchain = app.get<Contracts.Blockchain.Blockchain>(
        Container.Identifiers.BlockchainService,
    );

    const block: Interfaces.IBlockData = req.data.block;
    const fromForger: boolean = isWhitelisted(
        app
            .get<Providers.ServiceProviderRepository>(Container.Identifiers.ServiceProviderRepository)
            .get("@arkecosystem/core-p2p")
            .config()
            .get<string[]>("remoteAccess", []) || [],
        req.headers.remoteAddress,
    );

    if (!fromForger) {
        if (blockchain.pingBlock(block)) {
            return;
        }

        const lastDownloadedBlock: Interfaces.IBlockData = blockchain.getLastDownloadedBlock();

        if (!Utils.isBlockChained(lastDownloadedBlock, block)) {
            throw new UnchainedBlockError(lastDownloadedBlock.height, block.height);
        }
    }

    app.log.info(
        `Received new block at height ${block.height.toLocaleString()} with ${Utils.pluralize(
            "transaction",
            block.numberOfTransactions,
            true,
        )} from ${mapAddr(req.headers.remoteAddress)}`,
    );

    blockchain.handleIncomingBlock(block, fromForger);
};

export const postTransactions = async ({
    app,
    service,
    req,
}: {
    app: Contracts.Kernel.Application;
    service: PeerService;
    req;
}): Promise<string[]> => {
    const processor: Contracts.TransactionPool.Processor = app
        .get<Contracts.TransactionPool.Connection>(Container.Identifiers.TransactionPoolService)
        .makeProcessor();

    const result: Contracts.TransactionPool.ProcessorResult = await processor.validate(req.data.transactions);

    if (result.invalid.length > 0) {
        throw new InvalidTransactionsError();
    }

    if (result.broadcast.length > 0) {
        service.networkMonitor.broadcastTransactions(processor.getBroadcastTransactions());
    }

    return result.accept;
};

export const getBlocks = async ({
    app,
    req,
}: {
    app: Contracts.Kernel.Application;
    req: any;
}): Promise<Interfaces.IBlockData[] | Contracts.Database.DownloadBlock[]> => {
    const database: Contracts.Database.DatabaseService = app.get<Contracts.Database.DatabaseService>(
        Container.Identifiers.DatabaseService,
    );

    const reqBlockHeight: number = +req.data.lastBlockHeight + 1;
    const reqBlockLimit: number = +req.data.blockLimit || 400;
    const reqHeadersOnly: boolean = !!req.data.headersOnly;

    const blocks: Contracts.Database.DownloadBlock[] = await database.getBlocksForDownload(
        reqBlockHeight,
        reqBlockLimit,
        reqHeadersOnly,
    );

    app.log.info(
        `${mapAddr(req.headers.remoteAddress)} has downloaded ${Utils.pluralize(
            "block",
            blocks.length,
            true,
        )} from height ${reqBlockHeight.toLocaleString()}`,
    );

    return blocks;
};
