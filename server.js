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
    
    // 🎯 檢查點 1：快取命中直接吐資料
    if (accidentCache[selectedYear]) {
        console.log(`⚡️ [快取命中] 記憶體直接吐出西元 ${selectedYear} 年的數據，水管秒通！`);
        return res.json(accidentCache[selectedYear]);
    }
    
    try {
        console.log(`🔍 [快取未命中] 正在即時去資料庫撈取西元 ${selectedYear} 年的數據...`);
        
        const startKey = parseInt(`${selectedYear}0000`);
        const endKey = parseInt(`${selectedYear}9999`);

        // 💡 為了確保欄位乾淨不混淆，我們不使用 AS 別名，直接撈取資料庫最原始欄位名
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
            // 安全讀取數值，防止大小寫或別名遺失
            const rawLng = parseFloat(f.longitude || f.lng);
            const rawLat = parseFloat(f.latitude || f.lat);
            const death = f.death_count || f.death || 0;
            const injury = f.injury_count || f.injury || 0;

            // 🎯 終極防護：台灣的經度在 120~122 (大於50)，緯度在 22~25 (小於50)
            // 如果發現 rawLng 放成了 23.xxxx，表示經緯度欄位裝反了，程式自動幫你們對調！
            const correctLat = rawLng > 50 ? rawLat : rawLng;
            const correctLng = rawLng > 50 ? rawLng : rawLat;

            return {
                year: selectedYear,
                lat: correctLat,
                lng: correctLng,
                info: `車禍事故 - 死亡: ${death} 人, 受傷: ${injury} 人`
            };
        });

        // 🚀 核心優化 4：過濾掉沒有讀到經緯度的髒資料（0, 0 或 NaN），保證不噴去非洲
        const cleanRows = formattedRows.filter(item => item.lat > 20 && item.lng > 100);

        console.log(`✨ 成功撈出並校正 ${cleanRows.length} 筆有效資料！（已過濾掉 ${formattedRows.length - cleanRows.length} 筆無效座標）`);
        
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