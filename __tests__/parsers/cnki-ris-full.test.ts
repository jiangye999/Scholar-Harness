import { describe, it, expect } from 'vitest';
import { ParserFactory } from '../../src/literature/parsers/index';
import { RISParser } from '../../src/literature/parsers/ris-parser';

// 用户提供的实际知网导出的 RIS 格式
const REAL_CNKI_RIS = `RT Journal Article
SR 1
A1 Sharma Ashutosh;Georgi Mikhail;Tregubenko Maxim;Tselykh Alexey;Tselykh Alexander
T1 Enabling Smart Agriculture by Implementing Artificial Intelligence and Embedded Sensing
JF Computers & Industrial Engineering
YR 2022
IS prepublish
OP 107936-
K1 Computational intelligence technique;genetic algorithm;artificial neural network;varying lighting illuminations;color normalization
AB The increasing demand of smart agriculture has led to the significant growth and development in the field of crop estimation and prediction improving its productivity. The analysis of crop age status is very important to prevent the excessive fertilization, understand the proper time to harvest and reduce the production cost. Image based analysis using computational intelligence have proved beneficial in estimation of categorical age in the crops. This work focuses on the utilization of predictive computational intelligence technique for the evaluation of nitrogen status in wheat crop. The evaluation depends on the analysis of crop images captured in field at varying lighting illuminations. The wheat crop is initially subjected to HSI color normalization, followed by the optimization process using genetic algorithm (GA) and artificial neural network (ANN) based prediction and crop precision status classification. This ANN based optimized approach can significantly differentiate between the wheat crops from th...
SN 0360-8352
DS CNKI
LK https://link.cnki.net/doi/10.1016/J.CIE.2022.107936
DO 10.1016/J.CIE.2022.107936

RT Journal Article
SR 1
A1 康春鹏
AD 农业农村部信息中心;
T1 智慧农业建设的时代方位、突出亮点和问题建议
JF 农村工作通讯
YR 2022
IS 02
vo 
OP 23-25
AB 党中央、国务院高度重视网络安全与信息化,在农业农村信息化方面,习近平总书记多次强调要瞄准农业现代化的主攻方向,提高农业生产智能化和经营网络化水平。要加快推动数字产业化和产业数字化,推进农业数字化、网络化、智能化。特别是党的十九届五中全会站在"两个一百年奋斗目标"的战略高度,首次在全会的政治文件中提出建设智慧农业。这为我们加快建设智慧农业提供了千载难逢的历史机遇。智慧农业就是以数据为关键生产要素,以现代信息技术为手段,以人工智能为支撑,具有预测预警和优化资源配置两大突出特征的高级农业生产形态。
SN 0546-9503
CN 11-1617/F
LA 中文;
DS CNKI
LK https://kns.cnki.net/kcms2/article/abstract?v=xxx`;

describe('CNKI RIS - Full Real Format Test', () => {
  it('should validate real CNKI RIS content', () => {
    const parser = new RISParser();
    expect(parser.validate(REAL_CNKI_RIS)).toBe(true);
    console.log('[Test] RISParser.validate() returned true for CNKI RIS');
  });

  it('should parse real CNKI RIS via ParserFactory', () => {
    const results = ParserFactory.parseContent(REAL_CNKI_RIS, 'cnki-export.txt');
    
    console.log('[Test] ParserFactory.parseContent() results:', results.length, 'papers');
    
    // 应该解析出 2 篇文献
    expect(results.length).toBe(2);
    
    // 第一篇（英文）
    const first = results[0];
    console.log('[Test] Paper 1:', {
      title: first.title?.substring(0, 50),
      authors: first.authors?.length,
      year: first.year,
      journal: first.journal,
      abstract: first.abstract?.substring(0, 50),
      keywords: first.keywords?.length
    });
    
    expect(first.title).toBeDefined();
    expect(first.title).toContain('Smart Agriculture');
    expect(first.year).toBe(2022);
    expect(first.journal).toBe('Computers & Industrial Engineering');
    expect(first.abstract).toBeDefined();
    expect(first.abstract!.length).toBeGreaterThan(50);
    expect(first.keywords).toBeDefined();
    expect(first.keywords!.length).toBeGreaterThan(0);
    
    // 作者应该正确解析（分号分隔）
    expect(first.authors).toBeDefined();
    expect(first.authors!.length).toBeGreaterThanOrEqual(4);
    
    // 第二篇（中文）
    const second = results[1];
    console.log('[Test] Paper 2:', {
      title: second.title,
      authors: second.authors?.length,
      year: second.year,
      journal: second.journal,
      abstract: second.abstract?.substring(0, 30)
    });
    
    expect(second.title).toBe('智慧农业建设的时代方位、突出亮点和问题建议');
    expect(second.year).toBe(2022);
    expect(second.journal).toBe('农村工作通讯');
    expect(second.abstract).toBeDefined();
    expect(second.abstract).toContain('党中央');
    expect(second.authors).toBeDefined();
    expect(second.authors!.length).toBeGreaterThanOrEqual(1);
  });

  it('should produce papers with all fields needed for embedding', () => {
    const results = ParserFactory.parseContent(REAL_CNKI_RIS);
    
    // 检查每篇文献都有 embedding 需要的字段
    for (const paper of results) {
      expect(paper.title).toBeDefined();
      expect(paper.title!.length).toBeGreaterThan(0);
      
      // 检查有摘要（embedding 的关键）
      expect(paper.abstract).toBeDefined();
      console.log(`[Test] Paper "${paper.title?.substring(0, 30)}..." has abstract: ${paper.abstract?.length} chars`);
      
      // 检查关键词
      if (paper.keywords) {
        console.log(`[Test] Paper has ${paper.keywords.length} keywords`);
      }
    }
  });
});