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
    
    // 🎯 檢查點 1：【快取機制全面回歸】第二次點擊相同年份時，0.001 秒記憶體秒吐，拒絕重複撈取！
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

        // 🚀 核心優化 4：【後端多點地理圍欄（Poly-Geofencing）高精準防護網】
        // 嚴格將經緯度限制在台灣本島陸地與各主要離島範圍內，與前端 Map.html 完美同步！
        const cleanRows = formattedRows.filter(item => {
            // 1. 台灣本島：精準鎖定陸地大街小巷 (21.9~25.3, 120.1~122.1)
            if (item.lat >= 21.9 && item.lat <= 25.3 && item.lng >= 120.1 && item.lng <= 122.1) {
                return true;
            }
            
            // 2. 離島陸地絕對金鐘罩（經過精準微調，修正 TWD67/97 歷史偏誤點位）
            // 澎湖本島陸地精準格框
            if (item.lat >= 23.45 && item.lat <= 23.65 && item.lng >= 119.50 && item.lng <= 119.70) return true;
            // 澎湖七美、望安等南部島嶼
            if (item.lat >= 23.15 && item.lat <= 23.40 && item.lng >= 119.25 && item.lng <= 119.55) return true;
            
            // 金門陸地精準格框 (已修正 item 前綴漏打 bug)
            if (item.lat >= 24.40 && item.lat <= 24.55 && item.lng >= 118.22 && item.lng <= 118.45) return true;
            
            // 馬祖陸地精準格框 (南竿、北竿)
            if (item.lat >= 26.12 && item.lat <= 26.25 && item.lng >= 119.92 && item.lng <= 120.05) return true;
            
            // 綠島陸地精準格框
            if (item.lat >= 22.64 && item.lat <= 22.69 && item.lng >= 121.46 && item.lng <= 121.51) return true;
            
            // 蘭嶼陸地精準格框
            if (item.lat >= 22.00 && item.lat <= 22.08 && item.lng >= 121.50 && item.lng <= 121.60) return true;

            // 完全不符合以上安全邊界的無效點或北極圈大魔王，直接在這裡攔截抹除！
            return false;
        });

        console.log(`✨ 終極校正成功！共 ${cleanRows.length} 筆資料完美歸位台灣本島與各離島陸地！`);
        
        // 🎯 檢查點 2：將過濾後的乾淨資料存入快取倉庫
        accidentCache[selectedYear] = cleanRows;

        // 回傳給前端
        res.json(cleanRows); 

    } catch (err) {
        console.error("❌ 資料庫撈取失敗，錯誤訊息：", err);
        res.status(500).send('資料庫連線或查詢失敗');
    }
});

app.listen(3000, () => console.log('後端小秘書已在 http://localhost:3000 待命！'));