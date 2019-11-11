import { Container, Contracts, Utils as AppUtils } from "@arkecosystem/core-kernel";
import { Identities, Interfaces, Transactions, Utils } from "@arkecosystem/crypto";

import {
    InvalidMultiSignatureError,
    MultiSignatureAlreadyRegisteredError,
    MultiSignatureKeyCountMismatchError,
    MultiSignatureMinimumKeysError,
} from "../errors";
import { TransactionReader } from "../transaction-reader";
import { TransactionHandler, TransactionHandlerConstructor } from "./transaction";

// todo: revisit the implementation, container usage and arguments after core-database rework
// todo: replace unnecessary function arguments with dependency injection to avoid passing around references
@Container.injectable()
export class MultiSignatureTransactionHandler extends TransactionHandler {
    public getConstructor(): Transactions.TransactionConstructor {
        return Transactions.MultiSignatureRegistrationTransaction;
    }

    public dependencies(): ReadonlyArray<TransactionHandlerConstructor> {
        return [];
    }

    public walletAttributes(): ReadonlyArray<string> {
        return ["multiSignature"];
    }

    public async bootstrap(
        connection: Contracts.Database.Connection,
        walletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        const reader: TransactionReader = await TransactionReader.create(connection, this.getConstructor());

        while (reader.hasNext()) {
            const transactions = await reader.read();

            for (const transaction of transactions) {
                let wallet: Contracts.State.Wallet;
                let multiSignature: Contracts.State.WalletMultiSignatureAttributes;

                if (transaction.version === 1) {
                    multiSignature = transaction.asset.multisignature || transaction.asset.multiSignatureLegacy;
                    wallet = walletRepository.findByPublicKey(transaction.senderPublicKey);
                    multiSignature.legacy = true;
                } else {
                    AppUtils.assert.defined<string>(transaction.asset.multiSignature);

                    multiSignature = transaction.asset.multiSignature;
                    wallet = walletRepository.findByAddress(Identities.Address.fromMultiSignatureAsset(multiSignature));
                }

                if (wallet.hasMultiSignature()) {
                    throw new MultiSignatureAlreadyRegisteredError();
                }

                wallet.setAttribute("multiSignature", multiSignature);
                walletRepository.reindex(wallet);
            }
        }
    }

    // Technically, we only enable `MultiSignatureRegistration` when the `aip11` milestone is active,
    // but since there are no versioned transaction types yet we have to do it differently, to not break
    // existing legacy multi signatures. TODO: becomes obsolete with 3.0
    public async isActivated(): Promise<boolean> {
        return true;
    }

    public async throwIfCannotBeApplied(
        transaction: Interfaces.ITransaction,
        wallet: Contracts.State.Wallet,
        databaseWalletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        const { data }: Interfaces.ITransaction = transaction;

        if (Utils.isException(data.id)) {
            return;
        }

        AppUtils.assert.defined<Interfaces.IMultiSignatureAsset>(data.asset?.multiSignature);

        const { publicKeys, min } = data.asset.multiSignature;
        if (min < 1 || min > publicKeys.length || min > 16) {
            throw new MultiSignatureMinimumKeysError();
        }

        AppUtils.assert.defined<string[]>(data.signatures);

        if (publicKeys.length !== data.signatures.length) {
            throw new MultiSignatureKeyCountMismatchError();
        }

        const multiSigAddress: string = Identities.Address.fromMultiSignatureAsset(data.asset.multiSignature);
        const recipientWallet: Contracts.State.Wallet = databaseWalletRepository.findByAddress(multiSigAddress);

        if (recipientWallet.hasMultiSignature()) {
            throw new MultiSignatureAlreadyRegisteredError();
        }

        if (!wallet.verifySignatures(data, data.asset.multiSignature)) {
            throw new InvalidMultiSignatureError();
        }

        return super.throwIfCannotBeApplied(transaction, wallet, databaseWalletRepository);
    }

    public async canEnterTransactionPool(
        data: Interfaces.ITransactionData,
        pool: Contracts.TransactionPool.Connection,
        processor: Contracts.TransactionPool.Processor,
    ): Promise<boolean> {
        if (await this.typeFromSenderAlreadyInPool(data, pool, processor)) {
            return false;
        }

        return true;
    }

    public async applyToSender(
        transaction: Interfaces.ITransaction,
        walletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        await super.applyToSender(transaction, walletRepository);

        // Create the multi sig wallet
        if (transaction.data.version && transaction.data.version >= 2) {
            AppUtils.assert.defined<Interfaces.IMultiSignatureAsset>(transaction.data.asset?.multiSignature);

            walletRepository
                .findByAddress(Identities.Address.fromMultiSignatureAsset(transaction.data.asset.multiSignature))
                .setAttribute("multiSignature", transaction.data.asset.multiSignature);
        }
    }

    public async revertForSender(
        transaction: Interfaces.ITransaction,
        walletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        await super.revertForSender(transaction, walletRepository);
        // Nothing else to do for the sender since the recipient wallet
        // is made into a multi sig wallet.
    }

    public async applyToRecipient(
        transaction: Interfaces.ITransaction,
        walletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        const { data }: Interfaces.ITransaction = transaction;

        if (data.version && data.version >= 2) {
            AppUtils.assert.defined<Interfaces.IMultiSignatureAsset>(data.asset?.multiSignature);

            const recipientWallet: Contracts.State.Wallet = walletRepository.findByAddress(
                Identities.Address.fromMultiSignatureAsset(data.asset.multiSignature),
            );

            recipientWallet.setAttribute("multiSignature", data.asset.multiSignature);
        }
    }

    public async revertForRecipient(
        transaction: Interfaces.ITransaction,
        walletRepository: Contracts.State.WalletRepository,
    ): Promise<void> {
        const { data }: Interfaces.ITransaction = transaction;

        if (data.version && data.version >= 2) {
            AppUtils.assert.defined<Interfaces.IMultiSignatureAsset>(data.asset?.multiSignature);

            const recipientWallet: Contracts.State.Wallet = walletRepository.findByAddress(
                Identities.Address.fromMultiSignatureAsset(data.asset.multiSignature),
            );

            recipientWallet.forgetAttribute("multiSignature");
        }
    }
}
