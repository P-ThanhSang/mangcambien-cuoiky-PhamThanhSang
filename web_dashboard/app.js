let classifier = null;
let stream = null;
let isCamOn = false;
let animationFrameId = null;

const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const btnToggleCam = document.getElementById('btn-toggle-cam');
const rangeThreshold = document.getElementById('range-threshold');
const valThreshold = document.getElementById('val-threshold');
const camStatus = document.getElementById('camera-status');
const noCamMsg = document.getElementById('no-camera-msg');

const valInference = document.getElementById('val-inference');
const valFps = document.getElementById('val-fps');
const logList = document.getElementById('log-list');

// Các nhãn đồ uống
const classes = ['coc_nuoc', 'chai_nuoc', 'lon_bia', 'lon_coca'];
const barElements = {
    'coc_nuoc': document.getElementById('bar-coc'),
    'chai_nuoc': document.getElementById('bar-chai'),
    'lon_bia': document.getElementById('bar-bia'),
    'lon_coca': document.getElementById('bar-coca')
};
const pctElements = {
    'coc_nuoc': document.getElementById('pct-coc'),
    'chai_nuoc': document.getElementById('pct-chai'),
    'lon_bia': document.getElementById('pct-bia'),
    'lon_coca': document.getElementById('pct-coca')
};

let lastFrameTime = performance.now();
let fpsInterval = 1000;
let frameCount = 0;
let lastInferenceTime = 0;
const INFERENCE_INTERVAL = 250; // ms (Chạy suy luận 4 lần/giây để tránh flicker và tiết kiệm CPU)

// Cập nhật giá trị hiển thị của ngưỡng tin cậy
rangeThreshold.addEventListener('input', (e) => {
    valThreshold.textContent = e.target.value;
});

// Nút xóa log phát hiện
document.getElementById('btn-clear-log').addEventListener('click', () => {
    logList.innerHTML = '<div class="log-item empty">Chưa phát hiện vật thể nào...</div>';
});

// Khởi tạo Model SDK từ Edge Impulse
async function initModel() {
    try {
        console.log("Đang tải mô hình WebAssembly...");
        if (typeof EdgeImpulseClassifier !== 'undefined') {
            classifier = new EdgeImpulseClassifier();
            await classifier.init();
            console.log("Tải mô hình WebAssembly thành công.");
            console.log("Project info:", classifier.getProjectInfo());
            console.log("Properties:", classifier.getProperties());
        } else {
            console.warn("Chưa tìm thấy EdgeImpulseClassifier SDK. Giao diện sẽ chạy ở chế độ mô phỏng (Simulation).");
        }
    } catch (err) {
        console.error("Lỗi khi tải module WASM:", err);
    }
}

// Bật tắt Camera
btnToggleCam.addEventListener('click', async () => {
    if (!isCamOn) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 320, facingMode: 'user' },
                audio: false
            });
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                video.play();
                isCamOn = true;
                btnToggleCam.textContent = "Tắt Camera";
                btnToggleCam.style.backgroundColor = "#ef4444";
                camStatus.textContent = "Đang chạy";
                camStatus.className = "status-badge active";
                noCamMsg.style.display = "none";
                
                // Resize Canvas overlay trùng kích thước video
                canvas.width = video.clientWidth;
                canvas.height = video.clientHeight;
                
                // Bắt đầu vòng lặp dự đoán
                startInferenceLoop();
            };
        } catch (err) {
            alert("Không thể kết nối Camera: " + err.message);
        }
    } else {
        stopCamera();
    }
});

function stopCamera() {
    isCamOn = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    video.srcObject = null;
    btnToggleCam.textContent = "Bật Camera";
    btnToggleCam.style.backgroundColor = "var(--primary)";
    camStatus.textContent = "Đang tắt";
    camStatus.className = "status-badge";
    noCamMsg.style.display = "flex";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Reset charts
    classes.forEach(c => {
        barElements[c].style.width = '0%';
        pctElements[c].textContent = '0%';
    });
}

function startInferenceLoop() {
    if (!isCamOn) return;
    
    async function loop() {
        if (!isCamOn) return;
        
        let now = performance.now();
        if (now - lastInferenceTime >= INFERENCE_INTERVAL) {
            lastInferenceTime = now;
            let start = performance.now();
            
            // Vẽ khung hình webcam lên Canvas ẩn để lấy dữ liệu pixels
            const hiddenCanvas = document.createElement('canvas');
            hiddenCanvas.width = 160;
            hiddenCanvas.height = 160;
            const hiddenCtx = hiddenCanvas.getContext('2d');
            hiddenCtx.drawImage(video, 0, 0, 160, 160);
            
            const imgData = hiddenCtx.getImageData(0, 0, 160, 160);
            
            let pixels = [];
            // Edge Impulse WebAssembly classifier expects the raw signal.
            // For image projects, the signal is a flat array of width * height (25600 elements),
            // where each element is a 24-bit color integer (0xRRGGBB).
            for (let i = 0; i < imgData.data.length; i += 4) {
                let r = imgData.data[i];
                let g = imgData.data[i+1];
                let b = imgData.data[i+2];
                let color = (r << 16) | (g << 8) | b;
                pixels.push(color);
            }
            
            if (classifier) {
                try {
                    let res = classifier.classify(pixels);
                    let end = performance.now();
                    let duration = Math.round(end - start);
                    valInference.textContent = `${duration} ms`;
                    
                    // Tính toán FPS (Tốc độ suy luận thực tế)
                    frameCount++;
                    if (end > lastFrameTime + fpsInterval) {
                        let currentFps = Math.round((frameCount * 1000) / (end - lastFrameTime));
                        valFps.textContent = currentFps;
                        frameCount = 0;
                        lastFrameTime = end;
                    }
                    
                    // Vẽ bounding boxes và xử lý kết quả
                    processDetections(res.results || []);
                } catch (err) {
                    console.error("Lỗi khi suy luận:", err);
                    mockInference();
                }
            } else {
                mockInference();
            }
        }
        
        animationFrameId = requestAnimationFrame(loop);
    }
    
    requestAnimationFrame(loop);
}

function processDetections(boxes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const threshold = parseFloat(rangeThreshold.value);
    
    let maxProbs = { 'coc_nuoc': 0, 'chai_nuoc': 0, 'lon_bia': 0, 'lon_coca': 0 };
    
    // Log raw detections to console for debugging
    if (boxes.length > 0) {
        console.log("Raw detections:", boxes);
    }
    
    boxes.forEach(box => {
        // Update probability chart even if confidence is below threshold
        if (maxProbs[box.label] !== undefined && box.value > maxProbs[box.label]) {
            maxProbs[box.label] = box.value;
        }
        
        if (box.value >= threshold) {
            const x = (box.x / 160) * canvas.width;
            const y = (box.y / 160) * canvas.height;
            const w = (box.width / 160) * canvas.width;
            const h = (box.height / 160) * canvas.height;
            
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 3;
            ctx.strokeRect(x - w/2, y - h/2, w, h);
            
            ctx.fillStyle = '#22c55e';
            ctx.font = '14px Outfit';
            ctx.fillText(`${box.label} (${Math.round(box.value * 100)}%)`, x - w/2, y - h/2 - 5);
            
            addLog(box.label, box.value);
        }
    });
    
    classes.forEach(c => {
        let val = Math.round(maxProbs[c] * 100);
        barElements[c].style.width = `${val}%`;
        pctElements[c].textContent = `${val}%`;
    });
}

function mockInference() {
    let now = performance.now();
    valInference.textContent = `${Math.round(10 + Math.random() * 5)} ms`;
    frameCount++;
    if (now > lastFrameTime + fpsInterval) {
        valFps.textContent = Math.round((frameCount * 1000) / (now - lastFrameTime));
        frameCount = 0;
        lastFrameTime = now;
    }
    
    // Tạo giả lập phát hiện ngẫu nhiên khi bật camera chế độ simulation
    if (Math.random() < 0.02) {
        let randomClass = classes[Math.floor(Math.random() * classes.length)];
        let score = 0.55 + Math.random() * 0.4;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 3;
        
        // Vẽ khung giả lập ở giữa màn hình
        let x = canvas.width / 2;
        let y = canvas.height / 2;
        let rSize = 100;
        ctx.strokeRect(x - rSize/2, y - rSize/2, rSize, rSize);
        ctx.fillStyle = '#06b6d4';
        ctx.font = '14px Outfit';
        ctx.fillText(`${randomClass} (Sim: ${Math.round(score * 100)}%)`, x - rSize/2, y - rSize/2 - 5);
        
        addLog(randomClass, score);
        
        // Cập nhật chart
        classes.forEach(c => {
            if (c === randomClass) {
                barElements[c].style.width = `${Math.round(score*100)}%`;
                pctElements[c].textContent = `${Math.round(score*100)}%`;
            } else {
                barElements[c].style.width = '0%';
                pctElements[c].textContent = '0%';
            }
        });
    }
}

function addLog(label, score) {
    const time = new Date().toLocaleTimeString();
    const emptyLog = logList.querySelector('.empty');
    if (emptyLog) {
        logList.innerHTML = '';
    }
    
    const recentLogs = Array.from(logList.querySelectorAll('.log-item')).slice(0, 3);
    const isDuplicate = recentLogs.some(log => log.textContent.includes(label));
    if (isDuplicate) return;
    
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.textContent = `[${time}] Phát hiện ${label.replace('_', ' ')} (${Math.round(score * 100)}%)`;
    logList.insertBefore(logItem, logList.firstChild);
    
    if (logList.children.length > 20) {
        logList.removeChild(logList.lastChild);
    }
}

initModel();
