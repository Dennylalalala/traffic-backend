const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');    

const app = express();
app.use(cors()); 

// 1. 設定資料庫連線資訊
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '台灣交通事故追蹤和統計',
    password: process.env.DB_PASSWORD || '1234', 
    port: parseInt(process.env.DB_PORT || '5432'),
});

// 💡 核心優化 1：建立全域的「記憶體快取小倉庫」
const accidentCache = {};

// 2. 建立動態年份 API 通道
app.get('/api/live-accidents/:year', async (req, res) => {
    const selectedYear = req.params.year; 
    
    // // 🎯 檢查點 1：快取命中直接吐資料
    // if (accidentCache[selectedYear]) {
    //     console.log(`⚡️ [快取命中] 記憶體直接吐出西元 ${selectedYear} 年的數據，水管秒通！`);
    //     return res.json(accidentCache[selectedYear]);
    // }
    
    try {
        console.log(`🔍 [快取未命中] 正在即時去資料庫撈取西元 ${selectedYear} 年的數據...`);
        
        const startKey = parseInt(`${selectedYear}0000`);
        const endKey = parseInt(`${selectedYear}9999`);

        // 💡 直接撈取資料庫最原始欄位名
        const result = await pool.query(`
            SELECT 
                longitude,
                latitude,
                death_count,
                injury_count
            FROM public.fact_accidents
            WHERE time_key >= $1 AND time_key <= $2;
        `, [startKey, endKey]);
        
        if (result.rows.length > 0) {
            console.log(`📡 資料庫撈取成功！第一筆原始數據檢查：`, result.rows[0]);
        }

        // 💡 核心優化 3：防錯機制 + 經緯度絕對物理校正
        const formattedRows = result.rows.map(f => {
            // 直接讀取原始欄位
            const lngStr = f.longitude !== undefined ? f.longitude : f.lng;
            const latStr = f.latitude !== undefined ? f.latitude : f.lat;
            
            const rawLng = parseFloat(lngStr);
            const rawLat = parseFloat(latStr);
            const death = f.death_count || f.death || 0;
            const injury = f.injury_count || f.injury || 0;

            // 如果轉換出來是 NaN，先給個防禦值 0
            const finalLng = isNaN(rawLng) ? 0 : rawLng;
            const finalLat = isNaN(rawLat) ? 0 : rawLat;

            // 🎯 終極防護：台灣的經度在 120~122 (大於50)，緯度在 22~25 (小於50)
            // 加上常規範圍限制，如果數字飆到幾十萬（沒點小數點的髒整數），直接判定為 0
            let correctLat = 0;
            let correctLng = 0;

            if (finalLng > 100 && finalLng < 130 && finalLat > 20 && finalLat < 30) {
                // 情況一：欄位完全正確
                correctLat = finalLat;
                correctLng = finalLng;
            } else if (finalLat > 100 && finalLat < 130 && finalLng > 20 && finalLng < 30) {
                // 情況二：經緯度不幸裝反了，自動對調
                correctLat = finalLng;
                correctLng = finalLat;
            }

            return {
                year: selectedYear,
                lat: correctLat,
                lng: correctLng,
                info: `車禍事故 - 死亡: ${death} 人, 受傷: ${injury} 人`
            };
        });

        // 🚀 核心優化 4：終極台灣陸地護城河（Geofencing）
        // 嚴格將經緯度限制在台灣本島範圍內，超出此範圍、或是那些沒有點小數點的北極圈大魔王，當場全部抹除！
        const cleanRows = formattedRows.filter(item => {
            return item.lat >= 21.5 && item.lat <= 25.5 && 
                   item.lng >= 119.5 && item.lng <= 122.5;
        });

        console.log(`✨ 終極校正成功！共 ${cleanRows.length} 筆資料完美回歸台灣陸地！（已成功蒸發所有無效座標與北極髒數據！）`);
        
        // 🎯 檢查點 2：存入快取倉庫
        accidentCache[selectedYear] = cleanRows;

        // 回傳給前端
        res.json(cleanRows); 

    } catch (err) {
        console.error("❌ 資料庫撈取失敗，錯誤訊息：", err);
        res.status(500).send('資料庫連線或查詢失敗');
    }
});

app.listen(3000, () => console.log('後端小秘書已在 http://localhost:3000 待命！'));