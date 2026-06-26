
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell
} from 'recharts';

function DistributionChart({ buildingChartData }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={buildingChartData}
        margin={{ top: 20, right: 20, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} />
        <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} />
        <Tooltip
            contentStyle={{
              backgroundColor: '#141a2e',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px'
            }}
            labelStyle={{ color: 'var(--text-bright)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--primary)' }}
        />
        <Legend verticalAlign="top" height={36} />
        <Bar name="수량 (개)" dataKey="qty" fill="var(--primary)" radius={[4, 4, 0, 0]}>
          {buildingChartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--primary)' : 'var(--secondary)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default DistributionChart;
