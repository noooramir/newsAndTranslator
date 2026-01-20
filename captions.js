// ========== VIDEO CAPTION GENERATION ==========

let currentCaptions = { russian: '', english: '', videoId: '' };

const btnGenerate = document.getElementById('btn-generate');
const progressArea = document.getElementById('progress-area');
const videoPlayerArea = document.getElementById('video-player-area');
const videoContainer = document.getElementById('video-container');
const captionDisplay = document.getElementById('caption-display');

btnGenerate?.addEventListener('click', generateCaptions);
document.getElementById('btn-download-srt')?.addEventListener('click', downloadSRT);
document.getElementById('caption-language')?.addEventListener('change', updateCaptionLanguage);

async function generateCaptions() {
    const urlInput = document.getElementById('youtube-url');
    const url = urlInput.value.trim();
    
    if (!url) {
        alert('Please enter a YouTube URL');
        return;
    }
    
    progressArea.style.display = 'block';
    videoPlayerArea.style.display = 'none';
    btnGenerate.disabled = true;
    
    // Reset progress icons
    for (let i = 1; i <= 4; i++) {
        document.getElementById(`step-${i}`).textContent = '⏳';
    }
    
    try {
        // Step 1: Fetching
        document.getElementById('step-1').textContent = '🔄';
        
        const response = await fetch('http://localhost:3000/generate-captions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Step 2: Translating
        document.getElementById('step-1').textContent = '✅';
        document.getElementById('step-2').textContent = '🔄';
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 3: Generating
        document.getElementById('step-2').textContent = '✅';
        document.getElementById('step-3').textContent = '🔄';
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 4: Ready
        document.getElementById('step-3').textContent = '✅';
        document.getElementById('step-4').textContent = '✅';
        
        currentCaptions = {
            russian: data.russian_srt,
            english: data.english_srt,
            videoId: data.video_id
        };
        
        // Display video with captions
        displayVideoWithCaptions(url, data.english_srt);
        
        setTimeout(() => {
            progressArea.style.display = 'none';
            videoPlayerArea.style.display = 'block';
        }, 1000);
        
    } catch (error) {
        alert('Error generating captions: ' + error.message);
        progressArea.style.display = 'none';
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`step-${i}`).textContent = '❌';
        }
    } finally {
        btnGenerate.disabled = false;
    }
}

function displayVideoWithCaptions(url, srtContent) {
    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
    
    if (!videoId) {
        alert('Could not extract video ID');
        return;
    }
    
    videoContainer.innerHTML = `
        <iframe width="100%" height="400" 
                src="https://www.youtube.com/embed/${videoId}" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen>
        </iframe>
    `;
    
    parseSRTAndDisplay(srtContent);
}

function parseSRTAndDisplay(srtContent) {
    captionDisplay.innerHTML = `<div class="captions-box">${srtContent.replace(/\n/g, '<br>')}</div>`;
}

function downloadSRT() {
    const lang = document.getElementById('caption-language').value;
    let content = '';
    let filename = '';
    
    if (lang === 'en') {
        content = currentCaptions.english;
        filename = `english_captions_${currentCaptions.videoId}.srt`;
    } else if (lang === 'ru') {
        content = currentCaptions.russian;
        filename = `russian_captions_${currentCaptions.videoId}.srt`;
    } else {
        content = `=== RUSSIAN ===\n\n${currentCaptions.russian}\n\n=== ENGLISH ===\n\n${currentCaptions.english}`;
        filename = `both_captions_${currentCaptions.videoId}.txt`;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function updateCaptionLanguage() {
    const lang = document.getElementById('caption-language').value;
    
    if (lang === 'en') {
        parseSRTAndDisplay(currentCaptions.english);
    } else if (lang === 'ru') {
        parseSRTAndDisplay(currentCaptions.russian);
    } else {
        captionDisplay.innerHTML = `
            <div class="captions-box">
                <h4>Russian:</h4>
                ${currentCaptions.russian.replace(/\n/g, '<br>')}
                <hr>
                <h4>English:</h4>
                ${currentCaptions.english.replace(/\n/g, '<br>')}
            </div>
        `;
    }
}
