// ==UserScript==
// @name         Rakuten Magazine Downloader Paged
// @namespace    http://tampermonkey.net/
// @version      26.4.2
// @description  Download and convert Rakuten magazine pages with page range selection
// @author       Coelacanth
// @match        https://magazine.rakuten.co.jp/read/*
// @grant        GM_xmlhttpRequest
// @connect      data-cloudauthoring.magazine.rakuten.co.jp
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Add original CSS styles
    const style = document.createElement('style');
    style.textContent = `
        .magazine-downloader {
            position: fixed;
            right: 20px;
            bottom: 20px;
            padding: 12px 24px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            z-index: 10000;
            font-size: 14px;
            transition: all 0.3s;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        .magazine-downloader:hover {
            background: #45a049;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .magazine-downloader.loading {
            background: #f39c12;
            cursor: wait;
        }
        .debug-info {
            position: fixed;
            right: 20px;
            top: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 10000;
            display: none;
        }
        .progress-overlay {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10001;
            text-align: center;
            min-width: 300px;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background-color: #f0f0f0;
            border-radius: 10px;
            margin: 10px 0;
            overflow: hidden;
        }
        .progress-bar-fill {
            height: 100%;
            background-color: #4CAF50;
            width: 0%;
            transition: width 0.3s ease;
        }
        .backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
        }
        .page-range-dialog {
            background: white;
            padding: 20px;
            border-radius: 8px;
            width: 300px;
        }
        .page-range-input {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 15px 0;
        }
        .page-range-input input {
            width: 60px;
            padding: 5px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
        .dialog-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        }
        .dialog-button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .confirm-button {
            background: #4CAF50;
            color: white;
        }
        .cancel-button {
            background: #f0f0f0;
        }
    `;
    document.head.appendChild(style);

    const debugInfo = document.createElement('div');
    debugInfo.className = 'debug-info';
    document.body.appendChild(debugInfo);

    function showDebug(text) {
        debugInfo.style.display = 'block';
        debugInfo.textContent = text;
        console.log(text);
    }

    class MagazineDownloader {
        constructor() {
            this.zip = new JSZip();
            this.pageCount = 0;
            this.currentPage = 0;
            this.useThreeDigits = null; // 缓存页码位数判断结果
            this.downloadedPages = new Map(); // 缓存已下载的页面数据
        }

        extractParameters() {
            const scripts = document.getElementsByTagName('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content && content.includes('var issueId =')) {
                    const issueIdMatch = content.match(/var issueId = "([^"]+)"/);
                    const titleIdMatch = content.match(/var titleId = "([^"]+)"/);
                    const contentUrlMatch = content.match(/var contentUrl = "([^"]+)"/);

                    if (issueIdMatch && titleIdMatch && contentUrlMatch) {
                        const contentUrl = contentUrlMatch[1].replace(/\\\//g, '/');
                        const x1Match = contentUrl.match(/\/([^/]+)\/[^/]+\/[^/]+\/webreaderHTML/);

                        if (x1Match) {
                            return {
                                x1: x1Match[1],
                                x2: titleIdMatch[1],
                                x3: issueIdMatch[1]
                            };
                        }
                    }
                }
            }
            throw new Error('无法在页面中找到必要的参数');
        }

        async downloadPage(params, pageNum) {
            // 检查缓存中是否已有该页面数据
            if (this.downloadedPages.has(pageNum)) {
                return this.downloadedPages.get(pageNum);
            }

            // 如果已经确定了页码位数，直接使用对应格式
            if (this.useThreeDigits !== null) {
                const pageStr = pageNum.toString().padStart(this.useThreeDigits ? 3 : 2, '0');
                const url = `https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository/${params.x1}/${params.x2}/${params.x3}/webreaderHTML/complete/documents/AVED0_A0_L0_P${pageStr}.pdf`;

                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        responseType: 'arraybuffer',
                        onload: response => {
                            if (response.status === 200) {
                                const jpegData = this.extractJPEG(response.response);
                                if (jpegData) {
                                    // 缓存下载的数据
                                    this.downloadedPages.set(pageNum, jpegData);
                                    resolve(jpegData);
                                } else {
                                    reject(new Error('No JPEG data found'));
                                }
                            } else {
                                reject(new Error(`HTTP ${response.status}`));
                            }
                        },
                        onerror: reject
                    });
                });
            }

            // 首次下载时判断页码位数
            const pageStr3 = pageNum.toString().padStart(3, '0');
            const url3 = `https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository/${params.x1}/${params.x2}/${params.x3}/webreaderHTML/complete/documents/AVED0_A0_L0_P${pageStr3}.pdf`;

            try {
                const response3 = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url3,
                        responseType: 'arraybuffer',
                        onload: resolve,
                        onerror: reject
                    });
                });

                if (response3.status === 200) {
                    const jpegData = this.extractJPEG(response3.response);
                    if (jpegData) {
                        this.useThreeDigits = true;
                        // 缓存下载的数据
                        this.downloadedPages.set(pageNum, jpegData);
                        return jpegData;
                    }
                }
            } catch (error) {
                // 3位数格式失败，尝试2位数
            }

            // 尝试2位数格式
            const pageStr2 = pageNum.toString().padStart(2, '0');
            const url2 = `https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository/${params.x1}/${params.x2}/${params.x3}/webreaderHTML/complete/documents/AVED0_A0_L0_P${pageStr2}.pdf`;

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url2,
                    responseType: 'arraybuffer',
                    onload: response => {
                        if (response.status === 200) {
                            const jpegData = this.extractJPEG(response.response);
                            if (jpegData) {
                                this.useThreeDigits = false;
                                // 缓存下载的数据
                                this.downloadedPages.set(pageNum, jpegData);
                                resolve(jpegData);
                            } else {
                                reject(new Error('No JPEG data found'));
                            }
                        } else {
                            reject(new Error(`HTTP ${response.status}`));
                        }
                    },
                    onerror: reject
                });
            });
        }

        showProgress() {
            const backdrop = document.createElement('div');
            backdrop.className = 'backdrop';

            const overlay = document.createElement('div');
            overlay.className = 'progress-overlay';

            overlay.innerHTML = `
                <div class="progress-text">正在处理...</div>
                <div class="progress-bar">
                    <div class="progress-bar-fill"></div>
                </div>
                <div class="progress-status"></div>
            `;

            backdrop.appendChild(overlay);
            document.body.appendChild(backdrop);

            return {
                backdrop,
                updateProgress: (current, total, status) => {
                    const progressText = overlay.querySelector('.progress-text');
                    const progressBar = overlay.querySelector('.progress-bar-fill');
                    const progressStatus = overlay.querySelector('.progress-status');

                    progressText.textContent = status || `正在下载第 ${current} / ${total} 页...`;
                    progressBar.style.width = `${(current / total) * 100}%`;
                    if (status) {
                        progressStatus.textContent = status;
                    }
                }
            };
        }

        showPageRangeDialog(maxPage) {
            return new Promise((resolve) => {
                const dialog = document.createElement('div');
                dialog.className = 'progress-overlay page-range-dialog';
                dialog.innerHTML = `
                    <h3>选择下载页码范围</h3>
                    <div class="page-range-input">
                        <label>起始页:</label>
                        <input type="number" id="startPage" value="1" min="1" max="${maxPage}">
                        <label>结束页:</label>
                        <input type="number" id="endPage" value="${maxPage}" min="1" max="${maxPage}">
                    </div>
                    <div class="dialog-buttons">
                        <button class="dialog-button cancel-button">取消</button>
                        <button class="dialog-button confirm-button">确认下载</button>
                    </div>
                `;

                const backdrop = document.createElement('div');
                backdrop.className = 'backdrop';
                backdrop.appendChild(dialog);
                document.body.appendChild(backdrop);

                const startInput = dialog.querySelector('#startPage');
                const endInput = dialog.querySelector('#endPage');
                const confirmBtn = dialog.querySelector('.confirm-button');
                const cancelBtn = dialog.querySelector('.cancel-button');

                confirmBtn.addEventListener('click', () => {
                    const start = parseInt(startInput.value);
                    const end = parseInt(endInput.value);
                    if (start <= end && start >= 1 && end <= maxPage) {
                        backdrop.remove();
                        resolve({ start, end });
                    } else {
                        alert('请输入有效的页码范围');
                    }
                });

                cancelBtn.addEventListener('click', () => {
                    backdrop.remove();
                    resolve(null);
                });
            });
        }

        extractJPEG(pdfData) {
            const data = new Uint8Array(pdfData);
            const allJpegs = [];
            const preferredJpegs = [];
            const preferredMinSize = 200000;
        
            let pos = 0;
        
            while (true) {
                const start = this.findSequence(data, [0xFF, 0xD8], pos);
                if (start === -1) break;
        
                const end = this.findSequence(data, [0xFF, 0xD9], start);
                if (end === -1) break;
        
                const jpeg = data.slice(start, end + 2);
                allJpegs.push(jpeg);
                if (jpeg.length >= preferredMinSize) {
                    preferredJpegs.push(jpeg);
                }
        
                pos = end + 2;
            }
        
            // 有些正文页体积本来就小于阈值，不能直接判定为无效页。
            // 策略：优先使用大图；若没有大图则回退到该页中最大的 JPEG。
            const candidates = preferredJpegs.length > 0 ? preferredJpegs : allJpegs;
            if (candidates.length === 0) return null;
        
            // 选最大的（高清）
            let best = candidates[0];
            for (const img of candidates) {
                if (img.length > best.length) best = img;
            }
        
            return best;
        }

        findSequence(data, sequence, startFrom = 0) {
            for (let i = startFrom; i < data.length - sequence.length + 1; i++) {
                let found = true;
                for (let j = 0; j < sequence.length; j++) {
                    if (data[i + j] !== sequence[j]) {
                        found = false;
                        break;
                    }
                }
                if (found) return i;
            }
            return -1;
        }

        async start() {
            try {
                const params = this.extractParameters();
                showDebug('正在查找可用页面范围...');

                const searchingProgress = this.showProgress();
                searchingProgress.updateProgress(0, 1, '正在查找可用页面范围...');

                // 测试第一页并确定页码位数
                try {
                    const testData = await this.downloadPage(params, 0);
                    if (!testData) {
                        throw new Error('无法下载第一页');
                    }
                } catch (error) {
                    throw new Error(`无法访问文件: ${error.message}`);
                }

                // 获取最大页码，同时缓存已下载的页面数据
                let pageNum = 0;
                const maxPageToCheck = 1000; // 设置一个合理的上限，避免无限循环

                while (pageNum < maxPageToCheck) {
                    try {
                        await this.downloadPage(params, pageNum);
                        pageNum++;
                        // 更新进度显示
                        searchingProgress.updateProgress(pageNum, Math.min(pageNum + 10, maxPageToCheck), `已找到 ${pageNum} 页...`);
                    } catch (error) {
                        break;
                    }
                }

                if (pageNum === 0) {
                    throw new Error('未找到可下载的页面');
                }

                // 移除搜索进度显示
                searchingProgress.backdrop.remove();

                // 显示页码范围选择对话框
                const pageRange = await this.showPageRangeDialog(pageNum);
                if (!pageRange) {
                    return; // 用户取消下载
                }

                const startPage = pageRange.start - 1; // 转换为PDF页码
                const endPage = pageRange.end - 1;
                const totalPages = endPage - startPage + 1;

                const downloadProgress = this.showProgress();
                downloadProgress.updateProgress(0, totalPages, '准备下载...');

                // 检查哪些页面已经下载过，哪些还需要下载
                const pagesToDownload = [];
                const alreadyDownloaded = [];

                for (let i = startPage; i <= endPage; i++) {
                    if (this.downloadedPages.has(i)) {
                        alreadyDownloaded.push({ index: i - startPage, data: this.downloadedPages.get(i) });
                    } else {
                        pagesToDownload.push(i);
                    }
                }

                // 下载尚未缓存的页面
                for (let i = 0; i < pagesToDownload.length; i++) {
                    const pageIndex = pagesToDownload[i];
                    try {
                        const jpegData = await this.downloadPage(params, pageIndex);
                        alreadyDownloaded.push({ index: pageIndex - startPage, data: jpegData });
                        downloadProgress.updateProgress(alreadyDownloaded.length, totalPages, `下载第 ${pageIndex + 1} 页...`);
                    } catch (error) {
                        console.error(`Error downloading page ${pageIndex}:`, error);
                    }
                }

                // 按索引排序
                alreadyDownloaded.sort((a, b) => a.index - b.index);

                // 重新排序并保存到ZIP
                for (let i = 0; i < alreadyDownloaded.length; i++) {
                    const page = alreadyDownloaded[i];
                    if (page && page.data) {
                        // 计算文件名序号：偶数保持不变，奇数+2
                        const pdfPageNum = page.index + startPage; // 原始PDF的页码
                        let fileIndex;
                        if (pdfPageNum % 2 === 0) {
                            // 偶数页保持原值
                            fileIndex = pdfPageNum;
                        } else {
                            // 奇数页+2
                            fileIndex = pdfPageNum + 2;
                        }
                        // 保存文件，序号从0开始
                        this.zip.file(`${fileIndex}.jpg`, page.data);
                    }
                }

                downloadProgress.updateProgress(totalPages, totalPages, '正在生成ZIP文件...');

                // 生成并下载ZIP
                const content = await this.zip.generateAsync({type: 'blob'});
                const title = document.title.replace(/[/\\?%*:|"<>]/g, '-');
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${title}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                setTimeout(() => {
                    downloadProgress.backdrop.remove();
                    debugInfo.style.display = 'none';
                }, 1000);

            } catch (error) {
                console.error('Download error:', error);
                alert('下载失败: ' + error.message);
            }
        }
    }

    // 创建下载按钮
    const button = document.createElement('button');
    button.className = 'magazine-downloader';
    button.textContent = '下载杂志';
    document.body.appendChild(button);

    // 绑定点击事件
    let isDownloading = false;
    button.addEventListener('click', async () => {
        if (isDownloading) return;

        try {
            isDownloading = true;
            button.classList.add('loading');
            button.textContent = '查找页面范围...';

            const downloader = new MagazineDownloader();
            await downloader.start();

        } catch (error) {
            console.error('Error:', error);
            alert('发生错误: ' + error.message);
        } finally {
            isDownloading = false;
            button.classList.remove('loading');
            button.textContent = '下载杂志';
        }
    });
})();
