const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');    

const app = express();
app.use(cors()); 

// 1. 設定資料庫連線資訊（加入環境變數相容，防止密碼洩漏在 GitHub）
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '台灣交通事故追蹤和統計',
    password: process.env.DB_PASSWORD || '1234', // 本地端預設密碼
    port: parseInt(process.env.DB_PORT || '5432'),
});

// 2. 建立 API 通道
// 2. 升級：開闢一條可以接收「指定年份」的動態通道
app.get('/api/live-accidents/:year', async (req, res) => {
    // 從網址列抓取前端傳過來的年份 (例如：2021)
    const selectedYear = req.params.year; 
    
    try {
        console.log(`正在即時撈取西元 ${selectedYear} 年的完整車禍數據...`);
        
        // 💡 拔掉 LIMIT！但精準鎖定該年份，既能拿到全部，網頁又不會炸掉
        const result = await pool.query(`
            SELECT 
                SUBSTRING(f.time_key::text, 1, 4) AS year, 
                f.longitude AS lng,
                f.latitude AS lat,
                '【' || s.location_raw || '】 死亡:' || f.death_count || '人 受傷:' || f.injury_count || '人' AS info
            FROM public.fact_accidents f
            INNER JOIN public.staging_raw_accidents s 
                ON f.longitude = s.longitude_raw::NUMERIC 
               AND f.latitude = s.latitude_raw::NUMERIC
            WHERE f.time_key::text LIKE $1; -- $1 會被安全代入下面指定的參數
        `, [`${selectedYear}%`]);
        
        console.log(`成功撈出 ${result.rows.length} 筆資料！`);
        res.json(result.rows); 
    } catch (err) {
        console.error(err);
        res.status(500).send('資料庫連線失敗');
    }
});

app.listen(3000, () => console.log('後端小秘書已在 http://localhost:3000 待命！'));