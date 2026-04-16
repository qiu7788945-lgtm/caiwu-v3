import { format } from 'date-fns';

export const generateMonthList = () => {
  const startYear = 2026;
  const startMonth = 3; // 2026年03月
  const endYear = 2028;
  const endMonth = 3; // 2028年03月

  // 计算总月数差
  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1; 
  
  const months = [];
  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    months.push(format(d, 'yyyy年MM月'));
  }
  return months; // 正序排列，2026年03月在最上面
};
