import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GlobalService, NeonService, ChromeService } from '@/app/core';
import { Transaction, TransactionInput, InvocationTransaction } from '@cityofzion/neon-core/lib/tx';
import { wallet, tx, sc, u } from '@cityofzion/neon-core';
import { MatDialog } from '@angular/material/dialog';
import { PwdDialog } from '@/app/transfer/+pwd/pwd.dialog';
import { HttpClient } from '@angular/common/http';
import { NEO, UTXO, GAS } from '@/models/models';
import { Observable } from 'rxjs';
import { Fixed8 } from '@cityofzion/neon-core/lib/u';
import { map } from 'rxjs/operators';
import { ERRORS, requestTarget } from '@/models/dapi';

@Component({
    templateUrl: 'invoke.component.html',
    styleUrls: ['invoke.component.scss']
})
export class PopupNoticeInvokeComponent implements OnInit {
    private pramsData: any;
    public scriptHash = '';
    public operation = '';
    public args = null;
    public tx: Transaction;
    public attachedAssets = null;
    public fee = null;
    public broadcastOverride = null;
    public assetIntentOverrides = null;
    public loading = false;
    public loadingMsg: string;
    private messageID = 0;

    constructor(
        private aRoute: ActivatedRoute,
        private router: Router,
        private global: GlobalService,
        private neon: NeonService,
        private dialog: MatDialog,
        private http: HttpClient,
        private chrome: ChromeService
    ) { }

    ngOnInit(): void {
        this.aRoute.queryParams.subscribe((params: any) => {
            this.pramsData = params;
            this.messageID = params.messageID;
            if (params.network !== undefined) {
                if (params.network === 'MainNet') {
                    this.global.modifyNet('MainNet');
                } else {
                    this.global.modifyNet('TestNet');
                }
            }
            if (params.scriptHash !== undefined && params.operation !== undefined && params.args !== undefined) {
                this.scriptHash = params.scriptHash;
                this.operation = params.operation;
                let newJson = params.args.replace(/([a-zA-Z0-9]+?):/g, '"$1":');
                newJson = newJson.replace(/'/g, '"');
                this.args = JSON.parse(newJson);
                this.args.forEach((item, index) => {
                    if (item.type === 'Address') {
                        const param2 = u.reverseHex(wallet.getScriptHashFromAddress(item.value));
                        this.args[index] = param2;
                    }
                });
                this.fee = parseFloat(params.fee) || 0;
                if (this.pramsData.attachedAssets) {
                    newJson = this.pramsData.attachedAssets.replace(/([a-zA-Z0-9]+?):/g, '"$1":');
                    newJson = newJson.replace(/'/g, '"');
                    this.attachedAssets = JSON.parse(newJson);
                }
                if (this.assetIntentOverrides) {
                    newJson = this.pramsData.assetIntentOverrides.replace(/([a-zA-Z0-9]+?):/g, '"$1":');
                    newJson = newJson.replace(/'/g, '"');
                    this.assetIntentOverrides = JSON.parse(newJson);
                    this.fee = 0;
                    this.attachedAssets = null;
                }
                this.broadcastOverride = this.pramsData.broadcastOverride || false;
                setTimeout(() => {
                    this.pwdDialog();
                }, 0);
            } else {
                return;
            }
        });
        window.onbeforeunload = () => {
            this.chrome.windowCallback({
                error: ERRORS.CANCELLED,
                return: requestTarget.Invoke,
                ID: this.messageID
            });
        };
    }

    private pwdDialog() {
        this.dialog.open(PwdDialog, {
            disableClose: true
        }).afterClosed().subscribe((pwd) => {
            if (pwd && pwd.length) {
                this.global.log('start transfer with pwd');
                this.createTxForNEP5().then(res => {
                    this.resolveSign(res, pwd);
                }).catch(err => {
                    this.chrome.windowCallback({
                        error: ERRORS.MALFORMED_INPUT,
                        return: requestTarget.Invoke,
                        ID: this.messageID
                    });
                    window.close();
                });
            } else {
                this.global.log('cancel pay');
            }
        });
    }

    private resolveSign(transaction: Transaction, pwd: string) {
        this.loading = true;
        this.loadingMsg = 'Wait';
        if (transaction === null) {
            return;
        }
        this.neon.wallet.accounts[0].decrypt(pwd).then((acc) => {
            try {
                transaction.sign(acc);
            } catch (error) {
                console.log(error);
            }
            this.tx = transaction;
            if (this.broadcastOverride === true) {
                this.loading = false;
                this.loadingMsg = '';
                this.chrome.windowCallback({
                    data: {
                        txid: transaction.hash,
                        signedTX: this.tx.serialize(true)
                    },
                    return: requestTarget.Invoke,
                    ID: this.messageID
                });
            } else {
                this.resolveSend(this.tx);
            }
        }).catch((err) => {
            this.loading = false;
            this.loadingMsg = '';
            this.global.snackBarTip('verifyFailed', err);
            this.dialog.open(PwdDialog, {
                disableClose: true
            }).afterClosed().subscribe((pwdText) => {
                if (pwdText && pwdText.length) {
                    this.global.log('start transfer with pwd');
                    this.resolveSign(transaction, pwdText);
                } else {
                    this.global.log('cancel pay');
                }
            });
        });
    }

    private resolveSend(transaction: Transaction) {
        return this.http.post(`${this.global.apiDomain}/v1/transactions/transfer`, {
            signature_transaction: transaction.serialize(true)
        }).subscribe(async (res: any) => {
            this.loading = false;
            this.loadingMsg = '';
            if (!res.bool_status) {
                this.chrome.windowCallback({
                    error: ERRORS.RPC_ERROR,
                    return: requestTarget.Invoke,
                    ID: this.messageID
                });
                this.global.snackBarTip('transferFailed');
            } else {
                this.chrome.windowCallback({
                    data: {
                        txid: transaction.hash,
                        nodeURL: `${this.global.apiDomain}`
                    },
                    return: requestTarget.Invoke,
                    ID: this.messageID
                });
                const setData = {};
                setData[`${this.pramsData.network}TxArr`] = await this.chrome.getLocalStorage(`${this.pramsData.network}TxArr`) || [];
                setData[`${this.pramsData.network}TxArr`].push('0x' + transaction.hash);
                this.chrome.setLocalStorage(setData);
                this.router.navigate([{
                    outlets: {
                        transfer: ['transfer', 'result']
                    }
                }]);
            }
        }, err => {
            this.loading = false;
            this.loadingMsg = '';
            this.chrome.windowCallback({
                error: ERRORS.RPC_ERROR,
                return: requestTarget.Invoke,
                ID: this.messageID
            });
            this.global.snackBarTip('transferFailed', err);
        });
    }

    private createTxForNEP5(): Promise<Transaction> {
        return new Promise(async (resolve, reject) => {
            const fromScript = wallet.getScriptHashFromAddress(this.neon.address);
            const toScript = this.scriptHash.startsWith('0x') && this.scriptHash.length === 42 ? this.scriptHash.substring(2) : this.scriptHash;
            let newTx = new tx.InvocationTransaction();
            if (this.scriptHash.length !== 42 && this.scriptHash.length !== 40) {
                this.chrome.windowCallback({
                    error: ERRORS.MALFORMED_INPUT,
                    return: requestTarget.Invoke,
                    ID: this.messageID
                });
                this.loading = false;
                this.loadingMsg = '';
                window.close();
                return null;
            }
            try {
                newTx.script = sc.createScript({
                    scriptHash: this.scriptHash.startsWith('0x') && this.scriptHash.length === 42 ? this.scriptHash.substring(2) : this.scriptHash,
                    operation: this.operation,
                    args: this.args
                }) + 'f1';
            } catch (error) {
                reject(error);
            }
            if (this.assetIntentOverrides == null) {
                if (this.attachedAssets !== null) {
                    if (this.attachedAssets.NEO) {
                        try {
                            newTx = await this.addAttachedAssets(NEO, this.attachedAssets.NEO, fromScript, toScript, newTx);
                        } catch (error) {
                            this.chrome.windowCallback({
                                error: ERRORS.MALFORMED_INPUT,
                                return: requestTarget.Invoke,
                                ID: this.messageID
                            });
                            window.close();
                        }
                    }
                    if (this.attachedAssets.GAS) {
                        try {
                            newTx = await this.addAttachedAssets(GAS, this.attachedAssets.GAS, fromScript, toScript, newTx, this.fee);
                        } catch (error) {
                            console.log(error);
                        }
                    } else {
                        if (this.fee > 0) {
                            try {
                                newTx = await this.addFee(this.neon.wallet.accounts[0].address, newTx, this.fee);
                            } catch (error) {
                                console.log(error);
                            }
                        }
                    }
                } else {
                    if (this.fee > 0) {
                        try {
                            newTx = await this.addFee(this.neon.wallet.accounts[0].address, newTx, this.fee);
                        } catch (error) {
                            console.log(error);
                        }
                    }
                }
            } else {
                newTx.outputs = this.assetIntentOverrides.outlets;
                newTx.inputs = this.assetIntentOverrides.inputs;
            }
            newTx.addAttribute(tx.TxAttrUsage.Script, u.reverseHex(fromScript));
            const uniqTag = `from NEOLine at ${new Date().getTime()}`;
            newTx.addAttribute(tx.TxAttrUsage.Remark1, u.reverseHex(u.str2hexstring(uniqTag)));
            resolve(newTx);
        });
    }

    private getBalance(address: string, asset: string): Observable<UTXO[]> {
        return this.http.get(`${this.global.apiDomain}/v1/transactions/getutxoes?address=${address}&asset_id=${asset}`).pipe(map((res) => {
            return (res as any).result as UTXO[];
        }));
    }

    private addAttachedAssets(assetid: string, amount: number, fromScript: string,
        toScript: string, newTx: InvocationTransaction, fee: number = 0): Promise<InvocationTransaction> {
        return new Promise((resolve, reject) => {
            this.getBalance(this.neon.address, assetid).subscribe((balances: any) => {
                if (balances.length === 0) {
                    reject('no balance');
                }
                let assetId = balances[0].asset_id;
                if (assetId.startsWith('0x') && assetId.length === 66) {
                    assetId = assetId.substring(2);
                }
                newTx.addOutput({ assetId, value: new Fixed8(amount), scriptHash: toScript });
                let curr = 0.0;
                for (const item of balances) {
                    curr = this.global.mathAdd(curr, parseFloat(item.value) || 0);
                    newTx.inputs.push(new TransactionInput({
                        prevIndex: item.n, prevHash: item.txid.startsWith('0x') && item.txid.length == 66 ? item.txid.substring(2) : item.txid
                    }));
                    if (curr >= amount + fee) {
                        break;
                    }
                }
                const payback = (assetId === GAS || assetId === GAS.substring(2)) ?
                    this.global.mathSub(this.global.mathSub(curr, amount), fee) : this.global.mathSub(curr, amount);
                if (payback < 0) {
                    reject('no enough balance to pay');
                }
                if (payback > 0) {
                    newTx.addOutput({ assetId, value: new Fixed8(payback), scriptHash: fromScript });
                }
                resolve(newTx);
            });
        });
    }

    public addFee(from: string, newTx: InvocationTransaction, fee: number = 0): Promise<InvocationTransaction> {
        return new Promise((resolve, reject) => {
            this.getBalance(from, GAS).subscribe(res => {
                let curr = 0.0;
                for (const item of res) {
                    curr = this.global.mathAdd(curr, parseFloat(item.value) || 0);
                    newTx.inputs.push(new TransactionInput({
                        prevIndex: item.n,
                        prevHash: item.txid.startsWith('0x') && item.txid.length === 66 ?
                            item.txid.substring(2) : item.txid
                    }));
                    if (curr >= fee) {
                        break;
                    }
                }
                const payback = this.global.mathSub(curr, fee);
                if (payback < 0) {
                    reject('no enough GAS to fee');
                    this.chrome.windowCallback({
                        error: ERRORS.INSUFFICIENT_FUNDS,
                        return: requestTarget.Deploy,
                        ID: this.messageID
                    });
                    window.close();
                }
                if (payback > 0) {
                    const fromScript = wallet.getScriptHashFromAddress(from);
                    let gasAssetId = res[0].asset_id;
                    if (gasAssetId.startsWith('0x') && gasAssetId.length === 66) {
                        gasAssetId = gasAssetId.substring(2);
                    }
                    newTx.addOutput({ assetId: gasAssetId, value: this.global.mathSub(curr, fee), scriptHash: fromScript });
                }
                resolve(newTx);
            });
        });
    }

}
