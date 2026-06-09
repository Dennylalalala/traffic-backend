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
    
    // 🎯 檢查點 1：【重新啟用快取】第二次點擊相同年份時，0.001 秒直接記憶體秒吐，水管不塞車！
    if (accidentCache[selectedYear]) {
        console.log(`⚡️ [快取命中] 記憶體直接吐出西元 ${selectedYear} 年的數據，水管秒通！`);
        return res.json(accidentCache[selectedYear]);
    }
    
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
            const lngStr = f.longitude !== undefined ? f.longitude : f.lng;
            const latStr = f.latitude !== undefined ? f.latitude : f.lat;
            
            const rawLng = parseFloat(lngStr);
            const rawLat = parseFloat(latStr);
            const death = f.death_count || f.death || 0;
            const injury = f.injury_count || f.injury || 0;

            const finalLng = isNaN(rawLng) ? 0 : rawLng;
            const finalLat = isNaN(rawLat) ? 0 : rawLat;

            let correctLat = 0;
            let correctLng = 0;

            // 🎯 第一關防禦：先將正常小數點範圍的經緯度正確歸位
            if (finalLng > 100 && finalLng < 130 && finalLat > 20 && finalLat < 30) {
                correctLat = finalLat;
                correctLng = finalLng;
            } else if (finalLat > 100 && finalLat < 130 && finalLng > 20 && finalLng < 30) {
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

        // 🚀 核心優化 4：【終極本島收縮防禦】
        // 配合前端最新微調，緯度限制在 21.9 ~ 25.3，經度限制在 120.1 ~ 122.1
        // 把台灣本島邊緣、公海、澎湖外海的所有殘留髒點在後端大門直接人道毀滅！
        const cleanRows = formattedRows.filter(item => {
            return item.lat >= 21.9 && item.lat <= 25.3 && 
                   item.lng >= 120.1 && item.lng <= 122.1;
        });

        console.log(`✨ 終極校正成功！共 ${cleanRows.length} 筆資料完美回歸台灣本島陸地！`);
        
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