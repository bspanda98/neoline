export {
    getStorage,
    httpGet,
    httpPost,
    httpGetImage,
    setStorage,
    removeStorage,
    clearStorage,
    notification,
    setLocalStorage,
    removeLocalStorage,
    clearLocalStorage,
    getLocalStorage
} from '../common';
import {
    getStorage,
    setStorage,
    notification,
    httpPost,
    httpGet,
    setLocalStorage,
    getLocalStorage
} from '../common';
import { requestTarget, GetBalanceArgs, BalanceRequest, ERRORS, mainApi, testApi, EVENT } from '../common/data_module';
import { reverseHex, getScriptHashFromAddress } from '../common/utils';
/**
 * Background methods support.
 * Call window.NEOLineBackground to use.
 */
declare var chrome;

let currLang = 'en';
let tabCurr: any;

export const version = chrome.runtime.getManifest().version;

export function expand() {
    window.open('index.html#asset', '_blank');
}

(function init() {
    setInterval(() => {
        getStorage('net', async (res) => {
            const network = res || 'MainNet';
            const apiUrl = network === 'MainNet' ? mainApi : testApi;
            httpGet(`${apiUrl}/v1/getblockheight`, async (blockHeightData) => {
                const oldHeight = await getLocalStorage(`${network}BlockHeight`, () => {}) || 0;
                if (blockHeightData.bool_status && blockHeightData.result > oldHeight ) {
                    const setData = {};
                    setData[`${network}BlockHeight`] = blockHeightData.result;
                    setLocalStorage(setData);
                    httpGet(`${apiUrl}/v1/getblock?block_index=${blockHeightData.result}`, (blockDetail) => {
                        if (blockDetail.bool_status) {
                            const txStrArr = [];
                            blockDetail.result.tx.forEach(item => {
                                txStrArr.push(item.txid);
                            });
                            windowCallback({
                                data: {
                                    network,
                                    blockHeight: blockHeightData.result,
                                    blockTime: blockDetail.result.time,
                                    blockHash: blockDetail.result.hash,
                                    tx: txStrArr,
                                },
                                return: EVENT.BLOCK_HEIGHT_CHANGED
                            });
                        }

                    }, '*');
                }
            }, '*');
            const txArr = await getLocalStorage(`${network}TxArr`, (temp) => {}) || [];
            httpPost(`${apiUrl}/v1/transactions/confirms`, {txids: txArr}, (txConfirmData) => {
                if (txConfirmData.bool_status) {
                    const txConfirms = txConfirmData.result;
                    txConfirms.forEach(item => {
                        const tempIndex = txArr.findIndex(e => e === item);
                        if (tempIndex >= 0) {
                            txArr.splice(tempIndex, 1);
                        }
                        httpGet(`${apiUrl}/v1/transactions/gettransaction/${item}`, (txDetail) => {
                            if (txDetail.bool_status) {
                                windowCallback({
                                    data: {
                                        txid: txDetail.result.txID,
                                        blockHeight: txDetail.result.blockIndex,
                                        blockTime: txDetail.result.blockTime,
                                    },
                                    return: EVENT.TRANSACTION_CONFIRMED
                                });
                            }
                        }, '*');
                    });
                }
                const setData = {};
                setData[`${network}TxArr`] = txArr;
                setLocalStorage(setData);
            }, null);
        });
    }, 20000);
    if (navigator.language === 'zh-CN') {
        getStorage('lang', res => {
            if (res === undefined) {
                currLang = 'zh_CN';
                setStorage({ lang: currLang });
            }
        });
    }
    chrome.webRequest.onBeforeRequest.addListener(
        (details: any) => {
            if (details.url.indexOf(chrome.runtime.getURL('/index.html') < 0)) {
                return {
                    redirectUrl: details.url.replace(chrome.runtime.getURL(''), chrome.runtime.getURL('/index.html'))
                };
            } else {
                return {
                    redirectUrl: details.url
                };
            }
        }, {
            urls: [
                chrome.runtime.getURL('')
            ],
            types: ['main_frame']
        },
        ['blocking']
    );
})();

export function setPopup(lang) {
    switch (lang) {
        case 'zh_CN':
            currLang = 'zh_CN';
            break;
        case 'en':
            currLang = 'en';
            break;
    }
}

getLocalStorage('startTime', (time) => {
    if (time === undefined) {
        setLocalStorage({
            startTime: chrome.csi().startE
        });
        setLocalStorage({
            shouldLogin: true
        });
    } else {
        if (time !== chrome.csi().startE) {
            setLocalStorage({
                shouldLogin: true
            });
            setLocalStorage({
                startTime: chrome.csi().startE
            });
        }
    }
});


chrome.windows.onRemoved.addListener(() => {
    chrome.tabs.query({}, (res) => {
        if (res.length === 0) { // All browsers are closed
            setLocalStorage({
                shouldLogin: true
            });
        }
    });
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.target) {
        case requestTarget.Send:
            {
                const params = request.parameter;
                let queryString = '';
                for (const key in params) {
                    if (params.hasOwnProperty(key)) {
                        const value = params[key];
                        queryString += `${key}=${value}&`;
                    }
                }
                chrome.tabs.query({
                    active: true,
                    currentWindow: true
                }, (tabs) => {
                    tabCurr = tabs;
                });
                getLocalStorage('wallet', (wallet) => {
                    if (wallet !== undefined && wallet.accounts[0].address !== params.fromAddress) {
                        windowCallback({
                            return: requestTarget.Send,
                            error: ERRORS.MALFORMED_INPUT,
                            ID: request.ID
                        });
                    } else {
                        window.open(`index.html#popup/notification/transfer?${queryString}messageID=${request.ID}`,
                            '_blank', 'height=620, width=386, resizable=no, top=0, left=0');
                    }
                });
                sendResponse('');
                return true;
            }
        case requestTarget.Connect:
        case requestTarget.AuthState:
            {
                chrome.tabs.query({
                    active: true,
                    currentWindow: true
                }, (tabs) => {
                    tabCurr = tabs;
                });
                getStorage('connectedWebsites', (res: any) => {
                    if ((res !== undefined && res[request.hostname] !== undefined) || request.connect === 'true') {
                        if (res !== undefined && res[request.hostname] !== undefined && res[request.hostname].status === 'false') {
                            notification(chrome.i18n.getMessage('rejected'), chrome.i18n.getMessage('rejectedTip'));
                            windowCallback({
                                return: requestTarget.Connect,
                                data: false
                            });
                            return;
                        }
                        windowCallback({
                            return: requestTarget.Connect,
                            data: true
                        });
                        notification(`${chrome.i18n.getMessage('from')}: ${request.hostname}`, chrome.i18n.getMessage('connectedTip'));
                    } else {
                        window.open(`/index.html#popup/notification/authorization?icon=${request.icon}&hostname=${request.hostname}&title=${request.title}`, '_blank',
                            'height=620, width=386, resizable=no, top=0, left=0');
                    }
                });
                sendResponse('');
                return true;
            }
        case requestTarget.Balance: {
            const parameter = request.parameter as GetBalanceArgs;
            const postData = [];
            if (!(parameter.params as BalanceRequest[]).length) {
                const tempParams = parameter.params as BalanceRequest;
                const pushData = {
                    address: tempParams.address,
                    assets: tempParams.assets || [],
                    fetchUTXO: tempParams.fetchUTXO || false
                };
                postData.push(pushData);
            } else {
                (parameter.params as BalanceRequest[]).forEach(item => {
                    const pushData = {
                        address: item.address,
                        assets: item.assets || [],
                        fetchUTXO: item.fetchUTXO || false
                    };
                    postData.push(pushData);
                });
            }
            httpPost(`${parameter.network}/v1/getbalances`, { params: postData }, (returnData) => {
                windowCallback({
                    return: requestTarget.Balance,
                    data: returnData.result,
                    ID: request.ID,
                    error: returnData.bool_status ? null : ERRORS.RPC_ERROR
                });
            }, null);
            sendResponse('');
            return;
        }
        case requestTarget.InvokeRead: {
            const args = request.parameter[2];
            args.forEach((item, index) => {
                if (item.type === 'Address') {
                    args[index] = reverseHex(getScriptHashFromAddress(item.value))
                }
            });
            request.parameter[2] = args;
            const returnRes = {data: {}, ID: request.ID, return: requestTarget.InvokeRead, error: null};
            httpPost(`${request.network}/v1/transactions/invokeread`, { params: request.parameter }, (res) => {
                res.return = requestTarget.InvokeRead;
                if (res.bool_status) {
                    returnRes.data = {
                        script: res.result.script,
                        state: res.result.state,
                        gas_consumed: res.result.gas_consumed,
                        stack: res.result.stack
                    };
                } else {
                    returnRes.error = ERRORS.RPC_ERROR;
                }
                windowCallback(returnRes);
            }, null);
            sendResponse('');
            return;
        }
        case requestTarget.Invoke: {
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, (tabs) => {
                tabCurr = tabs;
            });
            const params = request.parameter;
            getStorage('connectedWebsites', (res) => {
                let queryString = '';
                for (const key in params) {
                    if (params.hasOwnProperty(key)) {
                        const value = key === 'args' || key === 'assetIntentOverrides' || key === 'attachedAssets' ||
                            key === 'assetIntentOverrides' || key === 'txHashAttributes' ?
                            JSON.stringify(params[key]) : params[key];
                        queryString += `${key}=${value}&`;
                    }
                }
                window.open(`index.html#popup/notification/invoke?${queryString}messageID=${request.ID}`,
                    '_blank', 'height=620, width=386, resizable=no, top=0, left=0');
            });
            sendResponse('');
            return;
        }
        case requestTarget.InvokeMulti: {
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, (tabs) => {
                tabCurr = tabs;
            });
            const params = request.parameter;
            getStorage('connectedWebsites', (res) => {
                let queryString = '';
                for (const key in params) {
                    if (params.hasOwnProperty(key)) {
                        const value = key === 'invokeArgs' || key === 'assetIntentOverrides' || key === 'attachedAssets' ||
                            key === 'assetIntentOverrides' || key === 'txHashAttributes' ?
                            JSON.stringify(params[key]) : params[key];
                        queryString += `${key}=${value}&`;
                    }
                }
                window.open(`index.html#popup/notification/invoke-multi?${queryString}messageID=${request.ID}`,
                    '_blank', 'height=620, width=386, resizable=no, top=0, left=0');
            });
            sendResponse('');
            return;
        }

        case requestTarget.Deploy: {
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, (tabs) => {
                tabCurr = tabs;
            });
            const params = request.parameter;
            getStorage('connectedWebsites', (res) => {
                let queryString = '';
                for (const key in params) {
                    if (params.hasOwnProperty(key)) {
                        const value = params[key];
                        queryString += `${key}=${value}&`;
                    }
                }
                window.open(`index.html#popup/notification/deploy?${queryString}messageID=${request.ID}`,
                    '_blank', 'height=620, width=386, resizable=no, top=0, left=0');
            });

            sendResponse('');
            return;
        }
    }
    sendResponse('');
    return true;
});

export function windowCallback(data) {
    if (tabCurr === null || tabCurr === undefined || tabCurr === []) {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, (tabs) => {
            tabCurr = tabs;
            if (tabCurr.length >= 1) {
                chrome.tabs.sendMessage(tabCurr[0].id, data, (response) => {
                    // tabCurr = null;
                });
            }
        });
    } else {
        if (tabCurr.length >= 1) {
            chrome.tabs.sendMessage(tabCurr[0].id, data, (response) => {
                // tabCurr = null;
            });
        }
    }
}
