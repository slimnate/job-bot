export type PostingTableRow = {
  _id: string;
  url: string;
  title: string;
  company: string;
  source: string;
  location?: string;
  postedAt?: number;
  discoveredAt: number;
  latestRanking: { scoreOverall: number } | null;
};

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

type PostingTableProps = {
  postings: PostingTableRow[] | undefined;
  emptyMessage?: string;
};

export function PostingTable({ postings, emptyMessage = 'No postings match these filters.' }: PostingTableProps) {
  return (
    <div className='table-wrapper'>
      <table>
        <thead>
          <tr>
            <th>Score</th>
            <th>Role</th>
            <th>Company</th>
            <th>Source</th>
            <th>Location</th>
            <th>Posted</th>
            <th>Discovered</th>
          </tr>
        </thead>
        <tbody>
          {postings?.length ? (
            postings.map((posting) => (
              <tr key={posting._id}>
                <td>{posting.latestRanking?.scoreOverall ?? '-'}</td>
                <td>
                  <a href={posting.url} target='_blank' rel='noreferrer'>
                    {posting.title}
                  </a>
                </td>
                <td>{posting.company}</td>
                <td>{posting.source}</td>
                <td>{posting.location ?? '-'}</td>
                <td>{formatDateTime(posting.postedAt)}</td>
                <td>{formatDateTime(posting.discoveredAt)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
